#!/usr/bin/env python3
"""Build a Copilot Studio agent into a Dataverse solution zip.

Each agent folder (agent/ for Daily Digest, filing-agent/ for Filing Assistant) holds the human-editable source (Copilot Studio YAML plus a
Markdown instructions file). This script assembles it into the same layout
Copilot Studio produces on solution export, so the zip can be imported with
`pac solution import` or the Power Apps maker portal.

    python3 build/build_solution.py                # -> out/FortifyDailyDigest_1_0_0_0.zip
    python3 build/build_solution.py --check        # also round-trip through `pac solution unpack`
    python3 build/build_solution.py --version 1.0.1.0
    python3 build/build_solution.py --pilot        # -> out/FortifyDailyDigestPilot_<version>.zip
    python3 build/build_solution.py --source filing-agent   # -> out/FortifyFilingAssistant_<version>.zip

--pilot builds a separate copy named "Daily Digest (Pilot)", with its own solution,
schema and connection reference names, so it can be installed next to the production
agent and shared with a pilot group without changing anyone else's Daily Digest.

"@@VERSION@@" anywhere in the agent source (instructions, topics, tools) is replaced with the solution version, so the
agent can show which build answered.
"""
import argparse
import base64
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from xml.sax.saxutils import escape, quoteattr

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
AGENT = ROOT / "agent"
OUT = ROOT / "out"

AUTH_MODE = {"None": 1, "Integrated": 2, "Custom": 3}
AUTH_TRIGGER = {"AsNeeded": 0, "Always": 1}
COMPONENT_TYPE = {"topic": 9, "action": 9, "gpt": 15}

# Renames applied to every source file for a --pilot build.
PILOT_RENAMES = [("fc_DailyDigest", "fc_DailyDigestPilot"),
                 ("FortifyDailyDigest", "FortifyDailyDigestPilot"),
                 ("Daily Digest", "Daily Digest (Pilot)")]
renames = []
build_version = [""]


def read_source(path):
    text = pathlib.Path(path).read_text(encoding="utf-8")
    for old, new in renames:
        text = text.replace(old, new)
    if build_version[0]:
        text = text.replace("@@VERSION@@", build_version[0])
    return text


def load_yaml(path):
    return yaml.safe_load(read_source(path))


def strip_metadata(text):
    """Remove the workspace-only `mcs.metadata:` block and comment lines."""
    out, skipping = [], False
    for line in text.splitlines():
        if line.startswith("mcs.metadata:"):
            skipping = True
            continue
        if skipping and (line.startswith(" ") or not line.strip()):
            continue
        skipping = False
        if line.lstrip().startswith("#"):
            continue
        out.append(line)
    return "\n".join(out).strip("\n") + "\n"


def gpt_component_data(agent_yaml_text, instructions):
    body = strip_metadata(agent_yaml_text)
    block = "instructions: |-\n" + "\n".join(
        ("  " + l) if l.strip() else "" for l in instructions.strip("\n").splitlines())
    body, n = re.subn(r'^instructions:.*$', lambda _: block, body, count=1, flags=re.M)
    if n != 1:
        sys.exit("agent.mcs.yml must contain an `instructions:` line")
    return body


def botcomponent_xml(schema, ctype, name, description, bot_schema):
    desc = f"\n  <description>{escape(description)}</description>" if description else ""
    return (f'<botcomponent schemaname={quoteattr(schema)}>\n'
            f'  <componenttype>{ctype}</componenttype>{desc}\n'
            f'  <iscustomizable>1</iscustomizable>\n'
            f'  <name>{escape(name)}</name>\n'
            f'  <parentbotid>\n    <schemaname>{bot_schema}</schemaname>\n  </parentbotid>\n'
            f'  <statecode>0</statecode>\n  <statuscode>1</statuscode>\n'
            f'</botcomponent>')


def workflow_xml(wf, json_path, version):
    """customizations.xml entry for a modern (Power Automate cloud) flow."""
    desc = f" Description={quoteattr(wf['description'])}" if wf.get("description") else ""
    lines = [
        f"<Workflow WorkflowId=\"{{{wf['id']}}}\" Name={quoteattr(wf['name'])}{desc}>",
        f"  <JsonFileName>/{json_path}</JsonFileName>",
        "  <Type>1</Type>", "  <Subprocess>0</Subprocess>", "  <Category>5</Category>", "  <Mode>0</Mode>",
        "  <Scope>4</Scope>", "  <OnDemand>0</OnDemand>", "  <TriggerOnCreate>0</TriggerOnCreate>",
        "  <TriggerOnDelete>0</TriggerOnDelete>", "  <AsyncAutodelete>0</AsyncAutodelete>",
        "  <SyncWorkflowLogOnFailure>0</SyncWorkflowLogOnFailure>", "  <StateCode>1</StateCode>",
        "  <StatusCode>2</StatusCode>", "  <RunAs>1</RunAs>", "  <IsTransacted>1</IsTransacted>",
        f"  <IntroducedVersion>{version}</IntroducedVersion>", "  <IsCustomizable>1</IsCustomizable>",
        "  <BusinessProcessType>0</BusinessProcessType>",
        "  <IsCustomProcessingStepAllowedForOtherPublishers>1</IsCustomProcessingStepAllowedForOtherPublishers>",
        "  <ModernFlowType>0</ModernFlowType>", "  <PrimaryEntity>none</PrimaryEntity>",
        "  <LocalizedNames>",
        f"    <LocalizedName languagecode=\"1033\" description={quoteattr(wf['name'])} />",
        "  </LocalizedNames>",
        "</Workflow>"]
    return "".join("\n    " + l for l in lines)


def solution_xml(sol, version, workflow_ids=()):
    pub = sol["publisher"]
    roots = "".join(f'\n      <RootComponent type="29" id="{{{w}}}" behavior="0" />' for w in workflow_ids)
    roots = f"<RootComponents>{roots}\n    </RootComponents>" if roots else "<RootComponents />"
    nil = lambda tag: f"<{tag} xsi:nil=\"true\"></{tag}>"
    addr_fields = ["City", "County", "Country", "Fax", "FreightTermsCode", "ImportSequenceNumber",
                   "Latitude", "Line1", "Line2", "Line3", "Longitude", "Name", "PostalCode",
                   "PostOfficeBox", "PrimaryContactName"]
    addr_tail = ["StateOrProvince", "Telephone1", "Telephone2", "Telephone3",
                 "TimeZoneRuleVersionNumber", "UPSZone", "UTCOffset", "UTCConversionTimeZoneCode"]

    def address(n):
        inner = "".join(f"\n          {nil(f)}" for f in addr_fields)
        tail = "".join(f"\n          {nil(f)}" for f in addr_tail)
        return (f"\n        <Address>\n          <AddressNumber>{n}</AddressNumber>"
                f"\n          <AddressTypeCode>1</AddressTypeCode>{inner}"
                f"\n          <ShippingMethodCode>1</ShippingMethodCode>{tail}\n        </Address>")

    return f"""<ImportExportXml version="9.2.26031.139" SolutionPackageVersion="9.2" languagecode="1033" generatedBy="CrmLive" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <SolutionManifest>
    <UniqueName>{sol['uniqueName']}</UniqueName>
    <LocalizedNames>
      <LocalizedName description={quoteattr(sol['displayName'])} languagecode="1033" />
    </LocalizedNames>
    <Descriptions>
      <Description description={quoteattr(sol.get('description', ''))} languagecode="1033" />
    </Descriptions>
    <Version>{version}</Version>
    <Managed>0</Managed>
    <Publisher>
      <UniqueName>{pub['uniqueName']}</UniqueName>
      <LocalizedNames>
        <LocalizedName description={quoteattr(pub['displayName'])} languagecode="1033" />
      </LocalizedNames>
      <Descriptions />
      {nil('EMailAddress')}
      {nil('SupportingWebsiteUrl')}
      <CustomizationPrefix>{pub['prefix']}</CustomizationPrefix>
      <CustomizationOptionValuePrefix>{pub['optionValuePrefix']}</CustomizationOptionValuePrefix>
      <Addresses>{address(1)}{address(2)}
      </Addresses>
    </Publisher>
    {roots}
    <MissingDependencies />
  </SolutionManifest>
</ImportExportXml>"""


def customizations_xml(conn_refs, workflows_xml=""):
    refs = "".join(f"""
    <connectionreference connectionreferencelogicalname={quoteattr(r['connectionReferenceLogicalName'])}>
      <connectionreferencedisplayname>{escape(r.get('displayName', r['connectionReferenceLogicalName']))}</connectionreferencedisplayname>
      <connectorid>{escape(r['connectorId'])}</connectorid>
      <iscustomizable>1</iscustomizable>
      <promptingbehavior>0</promptingbehavior>
      <statecode>0</statecode>
      <statuscode>1</statuscode>
    </connectionreference>""" for r in conn_refs)
    return f"""<ImportExportXml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Entities></Entities>
  <Roles></Roles>
  <Workflows>{workflows_xml}</Workflows>
  <FieldSecurityProfiles></FieldSecurityProfiles>
  <Templates />
  <EntityMaps />
  <EntityRelationships />
  <OrganizationSettings />
  <optionsets />
  <CustomControls />
  <EntityDataProviders />
  <connectionreferences>{refs}
  </connectionreferences>
  <Languages>
    <Language>1033</Language>
  </Languages>
</ImportExportXml>"""


def configuration_json(cfg):
    ai = dict(cfg.get("aISettings", {}))
    return {
        "$kind": "BotConfiguration",
        "settings": cfg.get("settings", {}),
        "isAgentConnectable": cfg.get("isAgentConnectable", False),
        "gPTSettings": {"$kind": "GPTSettings", **cfg["gPTSettings"]},
        "aISettings": {"$kind": "AISettings", **ai},
        "recognizer": {"$kind": cfg.get("recognizer", {}).get("kind", "GenerativeAIRecognizer")},
    }


def build(version=None, pilot=False, source="agent"):
    global AGENT
    AGENT = ROOT / source
    if not (AGENT / "solution.yml").exists():
        sys.exit(f"{source}/solution.yml not found")
    renames[:] = PILOT_RENAMES if pilot else []
    build_version[0] = version or load_yaml(AGENT / "solution.yml")["version"]
    sol = load_yaml(AGENT / "solution.yml")
    version = version or sol["version"]
    settings = load_yaml(AGENT / "settings.mcs.yml")
    bot = settings["schemaName"]
    conn_refs = load_yaml(AGENT / "connectionreferences.mcs.yml")["connectionReferences"]
    ref_names = {r["connectionReferenceLogicalName"] for r in conn_refs}

    files = {}  # zip path -> bytes/str
    components = []  # (schema, ctype, name, description, data)

    agent_text = read_source(AGENT / "agent.mcs.yml")
    agent_meta = load_yaml(AGENT / "agent.mcs.yml")["mcs.metadata"]
    instructions = read_source(AGENT / "instructions.md")
    # Copilot Studio parses {...} in instructions as Power Fx and fails to publish.
    for n, line in enumerate(instructions.splitlines(), 1):
        if "{" in line or "}" in line:
            sys.exit(f"{source}/instructions.md:{n}: curly braces are parsed as Power Fx by Copilot Studio; "
                     "use [square brackets] for placeholders")
    instructions = instructions.replace("@@VERSION@@", version)
    components.append((f"{bot}.gpt.default", COMPONENT_TYPE["gpt"], agent_meta["componentName"],
                       agent_meta.get("description"), gpt_component_data(agent_text, instructions)))

    tool_links = []
    for kind, folder in (("topic", "topics"), ("action", "tools")):
        for path in sorted((AGENT / folder).glob("*.mcs.yml")):
            text = read_source(path)
            doc = yaml.safe_load(text)
            meta = doc.get("mcs.metadata", {})
            schema = f"{bot}.{kind}.{path.name[:-len('.mcs.yml')]}"
            if len(doc.get("modelDescription", "")) > 1024:
                sys.exit(f"{path.name}: modelDescription is {len(doc['modelDescription'])} characters; "
                         "Copilot Studio allows at most 1024")
            if kind == "action":
                ref = doc["action"]["connectionReference"]
                if ref not in ref_names:
                    sys.exit(f"{path.name}: connection reference {ref} is not declared in connectionreferences.mcs.yml")
                if doc["action"].get("connectionProperties", {}).get("mode") != "Invoker":
                    sys.exit(f"{path.name}: tools must run in Invoker mode (end-user credentials)")
                tool_links.append((schema, ref))
            components.append((schema, COMPONENT_TYPE[kind], meta.get("componentName", path.stem),
                               meta.get("description"), strip_metadata(text)))

    for schema, ctype, name, desc, data in components:
        files[f"botcomponents/{schema}/botcomponent.xml"] = botcomponent_xml(schema, ctype, name, desc, bot)
        files[f"botcomponents/{schema}/data"] = data

    icon = base64.b64encode((AGENT / "icon.png").read_bytes()).decode()
    files[f"bots/{bot}/bot.xml"] = (
        f'<bot schemaname="{bot}">\n'
        f'  <authenticationmode>{AUTH_MODE[settings["authenticationMode"]]}</authenticationmode>\n'
        f'  <authenticationtrigger>{AUTH_TRIGGER[settings["authenticationTrigger"]]}</authenticationtrigger>\n'
        f'  <iconbase64>{icon}</iconbase64>\n'
        f'  <iscustomizable>1</iscustomizable>\n'
        f'  <language>{settings["language"]}</language>\n'
        f'  <name>{escape(settings["displayName"])}</name>\n'
        f'  <runtimeprovider>0</runtimeprovider>\n'
        f'  <template>{settings["template"]}</template>\n'
        f'</bot>')
    files[f"bots/{bot}/configuration.json"] = json.dumps(configuration_json(settings["configuration"]), indent=2)

    files["Assets/botcomponent_connectionreferenceset.xml"] = "<botcomponent_connectionreferenceset>" + "".join(
        f'\n  <botcomponent_connectionreference botcomponentid.schemaname={quoteattr(s)} '
        f'connectionreferenceid.connectionreferencelogicalname={quoteattr(r)}>\n'
        f'    <iscustomizable>1</iscustomizable>\n  </botcomponent_connectionreference>'
        for s, r in tool_links) + "\n</botcomponent_connectionreferenceset>"

    # Power Automate cloud flows packaged with the agent (<agent folder>/workflows/workflows.yml).
    workflow_ids, workflows_xml = [], ""
    manifest = AGENT / "workflows" / "workflows.yml"
    if manifest.exists():
        for wf in load_yaml(manifest)["workflows"]:
            text = read_source(AGENT / "workflows" / wf["file"])
            flow = json.loads(text)
            for ref in flow["properties"].get("connectionReferences", {}).values():
                name = ref["connection"]["connectionReferenceLogicalName"]
                if name not in ref_names:
                    sys.exit(f"{wf['file']}: connection reference {name} is not declared in connectionreferences.mcs.yml")
            json_path = f"Workflows/{re.sub(r'[^A-Za-z0-9]', '', wf['name'])}-{wf['id'].upper()}.json"
            files[json_path] = text
            workflow_ids.append(wf["id"])
            workflows_xml += workflow_xml(wf, json_path, version)
        if workflows_xml:
            workflows_xml += "\n  "

    files["solution.xml"] = solution_xml(sol, version, workflow_ids)
    files["customizations.xml"] = customizations_xml(conn_refs, workflows_xml)
    overrides = "".join(f'<Override PartName="/{p}" ContentType="application/octet-stream" />'
                        for p in files if p.endswith("/data"))
    files["[Content_Types].xml"] = (
        '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="xml" ContentType="application/octet-stream" />'
        '<Default Extension="json" ContentType="application/octet-stream" />'
        f'{overrides}</Types>')

    OUT.mkdir(exist_ok=True)
    zip_path = OUT / f"{sol['uniqueName']}_{version.replace('.', '_')}.zip"
    order = ["[Content_Types].xml", "solution.xml", "customizations.xml"]
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for p in order + sorted(p for p in files if p not in order):
            data = files[p]
            z.writestr(p, data.encode("utf-8") if isinstance(data, str) else data)
    print(f"Built {zip_path.relative_to(ROOT)}: {len(components)} components "
          f"({len(tool_links)} tools, {len(conn_refs)} connection references, {len(workflow_ids)} flows)")
    return zip_path


def check(zip_path):
    pac = shutil.which("pac")
    if not pac:
        sys.exit("--check needs the Power Platform CLI (pac) on PATH")
    with tempfile.TemporaryDirectory() as tmp:
        r = subprocess.run([pac, "solution", "unpack", "--zipfile", str(zip_path), "--folder", tmp,
                            "--packagetype", "Unmanaged"], capture_output=True, text=True)
        print(r.stdout[-2000:], r.stderr[-2000:])
        if r.returncode != 0 or "error" in r.stdout.lower():
            sys.exit("pac solution unpack reported a problem")
    print("pac solution unpack: OK")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", help="override solution version, e.g. 1.0.1.0")
    ap.add_argument("--check", action="store_true", help="validate with `pac solution unpack`")
    ap.add_argument("--source", default="agent",
                    help="agent folder to build: agent (Daily Digest, default) or filing-agent")
    ap.add_argument("--pilot", action="store_true",
                    help='build the separate "Daily Digest (Pilot)" agent for a pilot group')
    args = ap.parse_args()
    z = build(args.version, args.pilot, args.source)
    if args.check:
        check(z)
