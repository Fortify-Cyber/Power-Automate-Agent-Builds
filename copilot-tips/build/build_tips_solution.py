#!/usr/bin/env python3
"""Build the Friday Copilot Tips cloud flow into a Dataverse solution zip.

Sources (all in copilot-tips/):
  solution.yml         solution, flow, connection references, environment variables
  email-template.html  the email; compiled into the flow's "Email HTML" step
  tips/tips.csv        the tip library (loaded into SharePoint by scripts/New-TipsList.ps1)

    python3 build/build_tips_solution.py                 # -> out/FridayCopilotTips_<version>.zip
    python3 build/build_tips_solution.py --check         # also round-trip through `pac solution unpack`
    python3 build/build_tips_solution.py --previews      # also render every tip to out/previews/*.html
    python3 build/build_tips_solution.py --verify-links  # check every tip URL still resolves

Template syntax: {{Field}} is replaced with a tip field (HTML-escaped) or a setting;
"<!--IF Field-->...<!--ENDIF-->" keeps the block only when Field is not blank.
"""
import argparse
import csv
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile
from xml.sax.saxutils import escape, quoteattr

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO = ROOT.parent
OUT = REPO / "out"
TIME_ZONE = "Eastern Standard Time"  # Windows name; covers EST/EDT
TZ_LABEL = "ET"

TIP_COLUMNS = ["Title", "Subject", "WhyItMatters", "TipSteps", "TryPrompt", "LearnUrl", "LearnLabel",
               "VideoUrl", "VideoLabel", "WorksWith", "Notes"]
WORKS_WITH = ["Copilot Chat (everyone)", "Microsoft 365 Copilot license"]
ENV_TYPES = {"String": (100000000, "String"), "Boolean": (100000002, "Bool")}
STEP_LI = '<li style="margin:0 0 6px 0;">'


def load_yaml(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_tips():
    with open(ROOT / "tips" / "tips.csv", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != TIP_COLUMNS:
            sys.exit(f"tips/tips.csv: columns must be exactly {','.join(TIP_COLUMNS)}")
        tips = list(reader)
    problems = []
    for n, t in enumerate(tips, 2):
        for col in ("Title", "Subject", "TipSteps", "LearnUrl", "LearnLabel", "WorksWith"):
            if not t[col].strip():
                problems.append(f"line {n}: {col} is blank")
        if t["WorksWith"] not in WORKS_WITH:
            problems.append(f"line {n}: WorksWith must be one of {WORKS_WITH}")
        for col in ("LearnUrl", "VideoUrl"):
            if t[col] and not t[col].startswith("https://"):
                problems.append(f"line {n}: {col} must start with https://")
        if bool(t["VideoUrl"].strip()) != bool(t["VideoLabel"].strip()):
            problems.append(f"line {n}: VideoUrl and VideoLabel go together")
        if len(t["Subject"]) > 90:
            problems.append(f"line {n}: Subject is over 90 characters")
    if problems:
        sys.exit("tips/tips.csv:\n  " + "\n  ".join(problems))
    return tips


# ---------------------------------------------------------------- template

def read_template():
    text = (ROOT / "email-template.html").read_text(encoding="utf-8")
    # Drop ordinary comments (keep IF/ENDIF markers), then collapse whitespace so
    # the compiled expression stays on one line.
    text = re.sub(r"<!--(?!IF |ENDIF)(.*?)-->", "", text, flags=re.S)
    text = re.sub(r">\s+<", "><", text)
    text = re.sub(r"\s*\n\s*", " ", text).strip()
    return text


def template_parts(text):
    """Split into [('lit', s) | ('field', name) | ('if', name, parts)]."""
    def fields(s):
        out, pos = [], 0
        for m in re.finditer(r"\{\{(\w+)\}\}", s):
            if m.start() > pos:
                out.append(("lit", s[pos:m.start()]))
            out.append(("field", m.group(1)))
            pos = m.end()
        if pos < len(s):
            out.append(("lit", s[pos:]))
        return out

    parts, pos = [], 0
    for m in re.finditer(r"<!--IF (\w+)-->(.*?)<!--ENDIF-->", text, flags=re.S):
        parts += fields(text[pos:m.start()])
        inner = m.group(2)
        if "<!--IF" in inner:
            sys.exit("email-template.html: IF blocks can't be nested")
        parts.append(("if", m.group(1), fields(inner)))
        pos = m.end()
    parts += fields(text[pos:])
    for p in parts:
        if p[0] == "lit" and ("<!--IF" in p[1] or "<!--ENDIF" in p[1]):
            sys.exit("email-template.html: unmatched IF/ENDIF")
        if p[0] == "if" and any(q[0] == "lit" and re.search(r"[{}]", q[1]) for q in p[2]):
            sys.exit("email-template.html: no curly braces inside IF blocks")
    return parts


def render_local(parts, values):
    """Render the template in Python with the same rules the flow uses."""
    def run(ps):
        out = []
        for p in ps:
            if p[0] == "lit":
                out.append(p[1])
            elif p[0] == "field":
                out.append(values[p[1]])
            elif values[p[1]].strip():
                out.append(run(p[2]))
        return "".join(out)
    return run(parts)


def compile_flow(parts, expr):
    """Turn the template into a Power Automate string: literals + @{expressions}.

    expr(name) returns the workflow expression for a {{field}}."""
    def lit_expr(s):
        return "'" + s.replace("'", "''") + "'"

    out = []
    for p in parts:
        if p[0] == "lit":
            out.append(p[1].replace("@", "@@"))
        elif p[0] == "field":
            out.append("@{" + expr(p[1]) + "}")
        else:
            inner = [lit_expr(q[1]) if q[0] == "lit" else expr(q[1]) for q in p[2]]
            body = inner[0] if len(inner) == 1 else f"concat({', '.join(inner)})"
            out.append("@{if(empty(" + expr(p[1]) + "), '', " + body + ")}")
    return "".join(out)


def esc_html(s):
    """Escape exactly like the flow does (& < > " only)."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def steps_html(steps):
    """TipSteps: one step per line in SharePoint (" | " between steps in tips.csv)."""
    lines = [s.strip() for s in re.split(r"\r?\n|\s\|\s", steps) if s.strip()]
    return "".join(f"{STEP_LI}{esc_html(s)}</li>" for s in lines)


# ---------------------------------------------------------------- flow definition

def build_flow(cfg, parts):
    refs = cfg["connectionReferences"]
    envs = {e["schemaName"]: e for e in cfg["environmentVariables"]}
    pname = {k: f"{e['displayName']} ({k})" for k, e in envs.items()}

    def P(schema):
        return f"parameters('{pname[schema]}')"

    SITE, LIST = f"@{P('fc_FCT_SiteUrl')}", f"@{P('fc_FCT_ListName')}"
    REVIEWER = f"@{P('fc_FCT_ApproverEmail')}"

    def host(ref, op):
        api = refs[ref]["api"]
        return {"connectionName": api, "operationId": op, "apiId": f"/providers/Microsoft.PowerApps/apis/{api}"}

    def api_action(ref, op, params, run_after=None, kind="OpenApiConnection", **extra):
        a = {"type": kind, "inputs": {"host": host(ref, op), "parameters": params,
                                      "authentication": "@parameters('$authentication')"}}
        a.update(extra)
        a["runAfter"] = run_after or {}
        return a

    def email(to, subject, body, importance="Normal", run_after=None):
        return api_action("outlook", "SendEmailV2", {
            "emailMessage/To": to, "emailMessage/Subject": subject, "emailMessage/Body": body,
            "emailMessage/Importance": importance}, run_after)

    def terminate(status="Succeeded", run_after=None, message=None):
        inputs = {"runStatus": status}
        if message:
            inputs.update({"runError": {"message": message}})
        return {"type": "Terminate", "inputs": inputs, "runAfter": run_after or {}}

    def chain(*named):
        """Run actions in order: each one after the previous one succeeds."""
        acts, prev = {}, None
        for name, act in named:
            if prev and not act.get("runAfter"):
                act["runAfter"] = {prev: ["Succeeded"]}
            acts[name] = act
            prev = name
        return acts

    def esc(x):
        return (f"replace(replace(replace(replace({x}, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), "
                f"'\"', '&quot;')")

    def tip(col):
        return f"trim(coalesce(outputs('Current_tip')?['{col}'], ''))"

    note = lambda body: "<p style=\"font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;\">" + body + "</p>"
    tip_link = "<a href=\"@{outputs('Current_tip')?['{Link}']}\">open the tip in SharePoint</a>"
    when = "@{outputs('When_text')}"

    works_with = f"coalesce(outputs('Current_tip')?['WorksWith']?['Value'], '{WORKS_WITH[0]}')"
    tip_fields = {
        "Title": f"@{esc(tip('Title'))}",
        "Subject": f"@{esc(tip('Subject'))}",
        "WhyItMatters": f"@{esc(tip('WhyItMatters'))}",
        "TryPrompt": f"@{esc(tip('TryPrompt'))}",
        "LearnUrl": f"@{esc(tip('LearnUrl'))}",
        "LearnLabel": f"@{esc(tip('LearnLabel'))}",
        "VideoUrl": f"@{esc(tip('VideoUrl'))}",
        "VideoLabel": f"@{esc(tip('VideoLabel'))}",
        "WorksWith": f"@{esc(works_with)}",
        # One step per line -> <li> items. Blank lines are collapsed first.
        "StepsHtml": ("@concat('" + STEP_LI.replace("'", "''") + "', replace(replace(replace(replace("
                      + esc(tip("TipSteps")) + ", decodeUriComponent('%0D'), ''), "
                      "concat(decodeUriComponent('%0A'), decodeUriComponent('%0A')), decodeUriComponent('%0A')), "
                      "concat(decodeUriComponent('%0A'), decodeUriComponent('%0A')), decodeUriComponent('%0A')), "
                      "decodeUriComponent('%0A'), '</li>" + STEP_LI.replace("'", "''") + "'), '</li>')"),
        "OrgName": f"@{esc(P('fc_FCT_OrgName'))}",
        "SignOff": f"@{esc(P('fc_FCT_SignOff'))}",
        "BrandColor": f"@{esc(P('fc_FCT_BrandColor'))}",
        "IssueDate": "@formatDateTime(outputs('Send_at_local'), 'MMMM d, yyyy')",
    }

    def field_expr(banner):
        def expr(name):
            if name == "PreviewBanner":
                return banner
            if name not in tip_fields:
                sys.exit(f"email-template.html: unknown field {{{{{name}}}}}")
            return f"outputs('Tip')?['{name}']"
        return expr

    remaining = "sub(length(body('Get_queued_tips')?['value']), 1)"
    low_queue = (f"@{{if(less({remaining}, 3), concat('Heads-up: only ', string({remaining}), "
                 f"' tip(s) left in the queue after this one. Add more to the list soon.'), '')}}")

    banner_html = (
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" '
        'style="width:100%;max-width:600px;margin:0 0 12px 0;background-color:#fff4ce;border:1px solid #e0c35c;">'
        '<tr><td style="padding:12px 16px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#3b2f00;">'
        "@{if(" + P("fc_FCT_AutoSend") + ", "
        "'<strong>Heads-up:</strong> this tip goes out automatically', "
        "'<strong>Preview only &mdash; nothing has been sent.</strong> Approve or reject it in the Approvals request (Teams or Outlook). If approved, it goes out')}"
        f" <strong>{when}</strong> to @{{{P('fc_FCT_Recipients')}}}. "
        f"To change or skip it, {tip_link} (set Status to Skipped to skip)."
        "@{if(empty(outputs('Low_queue_warning')), '', concat('<br><strong>', outputs('Low_queue_warning'), '</strong>'))}"
        "</td></tr></table>")

    approval_details = (
        "**@{outputs('Current_tip')?['Subject']}**\n\n"
        f"If you approve, it goes to **@{{{P('fc_FCT_Recipients')}}}** **{when}**.\n\n"
        "The full preview is in your inbox (subject starts with **[Preview]**).\n\n"
        "- **Approve**: it sends automatically at that time.\n"
        "- **Reject**: nothing is sent and the tip stays in the queue. Fix it in SharePoint, then open the "
        "*Friday Copilot Tip* flow and select **Run** to get a fresh preview.\n\n"
        "@{outputs('Low_queue_warning')}")

    send_label = "@{formatDateTime(outputs('Send_at_local'), 'dddd, MMMM d')} at @{formatDateTime(outputs('Send_at_local'), 'h:mm tt')}"

    reviewer_path = chain(
        ("Ask_reviewer_to_approve", api_action("approvals", "StartAndWaitForAnApproval", {
            "approvalType": "Basic",
            "WebhookApprovalCreationInput/title": "Friday Copilot Tip for @{formatDateTime(outputs('Send_at_local'), 'MMM d')}: @{outputs('Current_tip')?['Title']}",
            "WebhookApprovalCreationInput/assignedTo": REVIEWER,
            "WebhookApprovalCreationInput/details": approval_details,
            "WebhookApprovalCreationInput/itemLink": "@{outputs('Current_tip')?['{Link}']}",
            "WebhookApprovalCreationInput/itemLinkDescription": "Edit this tip in SharePoint",
            "WebhookApprovalCreationInput/enableNotifications": True,
            "WebhookApprovalCreationInput/enableReassignment": True,
        }, kind="OpenApiConnectionWebhook", limit={"timeout": "PT32H"})),
        # Runs after Approve, Reject or timeout; anything but Approve stops here.
        ("Was_it_approved", {
            "type": "If",
            "expression": {"and": [{"equals": ["@body('Ask_reviewer_to_approve')?['outcome']", "Approve"]}]},
            "actions": {},
            "else": {"actions": chain(
                ("Rejected_or_timed_out", {
                    "type": "If",
                    "expression": {"and": [{"equals": ["@actions('Ask_reviewer_to_approve')?['status']", "TimedOut"]}]},
                    "actions": {"Tell_reviewer_no_decision": email(
                        REVIEWER, "Not sent (no decision): @{outputs('Current_tip')?['Subject']}",
                        note("Nobody approved or rejected this week's Copilot tip in time, so nothing was sent. The tip "
                             "is still <strong>Queued</strong> and will be offered again next Thursday.")
                        + note("To send it now instead, open the <em>Friday Copilot Tip</em> flow and select "
                               "<strong>Run</strong>."))},
                    "else": {"actions": {"Tell_reviewer_it_was_not_sent": email(
                        REVIEWER, "Not sent: @{outputs('Current_tip')?['Subject']}",
                        note("You rejected this week's Copilot tip, so nothing was sent. It is still <strong>Queued</strong>.")
                        + note(f"To send a corrected version: {tip_link}, fix it, then open the <em>Friday Copilot Tip</em> "
                               "flow in Power Automate and select <strong>Run</strong>. You'll get a new preview to approve.")
                        + note("To skip it for good, set its Status to <strong>Skipped</strong>. Otherwise it will be "
                               "offered again next Thursday.")
                        + note("Your comments: @{coalesce(body('Ask_reviewer_to_approve')?['responses']?[0]?['comments'], '(none)')}"))}},
                }),
                ("Stop_not_approved", terminate()))},
            "runAfter": {"Ask_reviewer_to_approve": ["Succeeded", "TimedOut"]},
        }),
    )

    shared = P("fc_FCT_SharedMailbox")
    send_step = {
        "type": "If",
        "expression": {"and": [{"contains": [f"@{shared}", "@"]}]},
        # Shared mailbox: address it to the mailbox itself and Bcc the recipients,
        # so a reply-all can't reach the whole organization.
        "actions": {"Send_from_shared_mailbox": api_action("outlook", "SharedMailboxSendEmailV2", {
            "emailMessage/MailboxAddress": f"@{shared}",
            "emailMessage/To": f"@{shared}",
            "emailMessage/Bcc": f"@{P('fc_FCT_Recipients')}",
            "emailMessage/Subject": "@{outputs('Current_tip')?['Subject']}",
            "emailMessage/Body": "@{outputs('Email_HTML')}",
            "emailMessage/Importance": "Normal"})},
        "else": {"actions": {"Send_from_flow_owner": api_action("outlook", "SendEmailV2", {
            "emailMessage/To": f"@{P('fc_FCT_Recipients')}",
            "emailMessage/Subject": "@{outputs('Current_tip')?['Subject']}",
            "emailMessage/Body": "@{outputs('Email_HTML')}",
            "emailMessage/Importance": "Normal"})}},
    }

    main = chain(
        # Next Friday (today if it's Friday) at the configured send time, Eastern.
        ("Send_at_local", {"type": "Compose", "inputs": (
            f"@{{formatDateTime(addDays(convertFromUtc(utcNow(), '{TIME_ZONE}'), mod(add(sub(5, dayOfWeek("
            f"convertFromUtc(utcNow(), '{TIME_ZONE}'))), 7), 7)), 'yyyy-MM-dd')}}T@{{trim({P('fc_FCT_SendTime')})}}:00")}),
        ("Send_at_utc", {"type": "Compose", "inputs": f"@convertToUtc(outputs('Send_at_local'), '{TIME_ZONE}')"}),
        ("Send_label", {"type": "Compose", "inputs": send_label}),
        ("When_text", {"type": "Compose", "inputs": (
            f"@{{if({P('fc_FCT_SendNow')}, if({P('fc_FCT_AutoSend')}, 'right away (test mode is on)', "
            f"'as soon as it is approved (test mode is on)'), "
            f"concat('on ', outputs('Send_label'), ' {TZ_LABEL}'))}}")}),
        ("Get_queued_tips", api_action("sharepoint", "GetItems", {
            "dataset": SITE, "table": LIST, "$filter": "Status eq 'Queued'",
            "$orderby": "WeekDate asc, ID asc", "$top": 5})),
        ("Is_the_queue_empty", {
            "type": "If",
            "expression": {"and": [{"equals": ["@length(body('Get_queued_tips')?['value'])", 0]}]},
            "actions": chain(
                ("Tell_reviewer_queue_is_empty", email(
                    REVIEWER, "No Copilot tip this week: the queue is empty",
                    note("There are no tips with Status <strong>Queued</strong> in the SharePoint list, so nothing "
                         "will be sent this Friday.")
                    + note("Add tips to the list (Status = Queued), then open the <em>Friday Copilot Tip</em> flow and "
                           "select <strong>Run</strong>."), "High")),
                ("Stop_empty_queue", terminate())),
            "else": {"actions": {}},
        }),
        ("Current_tip", {"type": "Compose", "inputs": "@first(body('Get_queued_tips')?['value'])"}),
        ("Low_queue_warning", {"type": "Compose", "inputs": low_queue}),
        ("Tip", {"type": "Compose", "inputs": tip_fields}),
        ("Email_HTML", {"type": "Compose", "inputs": compile_flow(parts, field_expr("''"))}),
        ("Preview_banner", {"type": "Compose", "inputs": banner_html}),
        ("Preview_HTML", {"type": "Compose", "inputs": compile_flow(parts, field_expr("outputs('Preview_banner')"))}),
        ("Send_preview_to_reviewer", email(
            REVIEWER,
            "@{if(" + P("fc_FCT_AutoSend") + ", '[Heads-up] ', '[Preview] ')}@{outputs('Current_tip')?['Subject']}",
            "@{outputs('Preview_HTML')}", "High")),
        ("Review_required", {
            "type": "If",
            "expression": {"and": [{"equals": [f"@{P('fc_FCT_AutoSend')}", False]}]},
            "actions": reviewer_path,
            "else": {"actions": {}},
        }),
        ("Wait_until_Friday", {"type": "Wait", "inputs": {"until": {
            "timestamp": f"@{{if({P('fc_FCT_SendNow')}, utcNow(), outputs('Send_at_utc'))}}"}}}),
        # Re-read the tip: someone may have set it to Skipped since the preview.
        ("Get_tip_again", api_action("sharepoint", "GetItem", {
            "dataset": SITE, "table": LIST, "id": "@outputs('Current_tip')?['ID']"})),
        ("OK_to_send", {
            "type": "If",
            "expression": {"and": [
                {"equals": ["@body('Get_tip_again')?['Status']?['Value']", "Queued"]},
                {"or": [{"equals": [f"@{P('fc_FCT_SendNow')}", True]},
                        {"less": ["@ticks(utcNow())", "@ticks(addHours(outputs('Send_at_utc'), 8))"]}]}]},
            "actions": {},
            "else": {"actions": chain(
                ("Tell_reviewer_it_was_held", email(
                    REVIEWER, "Not sent: @{outputs('Current_tip')?['Subject']}",
                    note("This week's Copilot tip was not sent because "
                         "@{if(equals(body('Get_tip_again')?['Status']?['Value'], 'Queued'), "
                         "'it was approved more than 8 hours after the planned send time.', "
                         "concat('its Status was changed to ', body('Get_tip_again')?['Status']?['Value'], '.'))}")
                    + note("To send it now, set its Status back to Queued, open the <em>Friday Copilot Tip</em> "
                           "flow and select <strong>Run</strong>."))),
                ("Stop_held", terminate()))},
        }),
        ("Send_the_tip", send_step),
        ("Mark_tip_as_sent", api_action("sharepoint", "PatchItem", {
            "dataset": SITE, "table": LIST, "id": "@outputs('Current_tip')?['ID']",
            "item/Title": "@outputs('Current_tip')?['Title']",
            "item/Status/Value": "Sent",
            "item/SentOn": "@utcNow()"})),
        ("Confirm_to_reviewer", email(
            REVIEWER, "Sent: @{outputs('Current_tip')?['Subject']}",
            note(f"This week's Copilot tip went to @{{{P('fc_FCT_Recipients')}}} and is marked <strong>Sent</strong> in the list.")
            + "@{if(empty(outputs('Low_queue_warning')), '', concat('<p style=\"font-family:Segoe UI,Arial,sans-serif;"
              "font-size:14px;\"><strong>', outputs('Low_queue_warning'), '</strong></p>'))}")),
    )

    run_link = ("https://make.powerautomate.com/environments/@{workflow()?['tags']?['environmentName']}"
                "/flows/@{workflow()?['name']}/runs/@{workflow()?['run']?['name']}")
    actions = {
        "Run_the_weekly_tip": {"type": "Scope", "actions": main, "runAfter": {}},
        "Tell_reviewer_something_failed": email(
            REVIEWER, "Problem with the Friday Copilot Tip flow",
            note("The <em>Friday Copilot Tip</em> flow hit an error, so this week's tip may not have been sent.")
            + note(f"<a href=\"{run_link}\">Open the failed run</a> to see which step failed. The usual causes are a "
                   "connection that needs signing in again, a changed list or column name, or missing Send As "
                   "permission on the shared mailbox."), "High",
            run_after={"Run_the_weekly_tip": ["Failed", "TimedOut"]}),
        "Mark_run_failed": terminate("Failed", {"Tell_reviewer_something_failed": ["Succeeded", "Failed"]},
                                     "The weekly tip run failed; see the Run_the_weekly_tip scope."),
    }

    params = {"$connections": {"defaultValue": {}, "type": "Object"},
              "$authentication": {"defaultValue": {}, "type": "SecureObject"}}
    for k, e in envs.items():
        _, ptype = ENV_TYPES[e["type"]]
        default = e.get("default", "")
        if e["type"] == "Boolean":
            default = str(default).lower() in ("yes", "true", "1")
        params[pname[k]] = {"defaultValue": default, "type": ptype,
                            "metadata": {"schemaName": k, "description": e["description"]}}

    week = cfg["flow"]["weeklyPreview"]
    definition = {
        "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        "contentVersion": "1.0.0.0",
        "parameters": params,
        "triggers": {"Every_Thursday_morning": {
            "type": "Recurrence",
            "recurrence": {"frequency": "Week", "interval": 1, "timeZone": TIME_ZONE,
                           "schedule": {"weekDays": [week["day"]], "hours": [str(week["hour"])], "minutes": [0]}},
        }},
        "actions": actions,
    }
    conn_refs = {r["api"]: {"runtimeSource": "embedded",
                            "connection": {"connectionReferenceLogicalName": r["logicalName"]},
                            "api": {"name": r["api"]}} for r in refs.values()}
    return {"properties": {"connectionReferences": conn_refs, "definition": definition, "templateName": ""},
            "schemaVersion": "1.0.0.0"}


KNOWN_FUNCTIONS = {
    "actions", "add", "addDays", "addHours", "and", "body", "coalesce", "concat", "contains", "convertFromUtc",
    "convertToUtc", "dayOfWeek", "decodeUriComponent", "empty", "equals", "first", "formatDateTime", "if",
    "length", "less", "mod", "outputs", "parameters", "replace", "string", "sub", "ticks", "trim",
    "utcNow", "workflow"}


def scan_expression(expr, where):
    """Light syntax check of one workflow expression: quotes, brackets, function names."""
    depth, i, problems = [], 0, []
    pairs = {")": "(", "]": "["}
    while i < len(expr):
        c = expr[i]
        if c == "'":
            j = i + 1
            while True:
                j = expr.find("'", j)
                if j < 0:
                    return [f"{where}: unterminated string in {expr[:80]}"]
                if expr[j + 1:j + 2] == "'":
                    j += 2
                    continue
                break
            i = j + 1
            continue
        if c in "([":
            if c == "(":
                name = re.search(r"([A-Za-z_]\w*)\s*$", expr[:i])
                if name and name.group(1) not in KNOWN_FUNCTIONS:
                    problems.append(f"{where}: unknown function {name.group(1)}()")
            depth.append(c)
        elif c in ")]":
            if not depth or depth.pop() != pairs[c]:
                return [f"{where}: unbalanced '{c}' in {expr[:80]}"]
        i += 1
    if depth:
        problems.append(f"{where}: unclosed bracket in {expr[:80]}")
    return problems


def expressions_in(value):
    """Yield the expressions inside a workflow string value."""
    if not value.startswith("@") or value.startswith("@@"):
        pos = 0
    elif not value.startswith("@{"):
        yield value[1:]
        return
    else:
        pos = 0
    while True:
        k = value.find("@{", pos)
        if k < 0:
            return
        if k > 0 and value[k - 1] == "@" and (k < 2 or value[k - 2] != "@"):
            pos = k + 2
            continue
        # find the closing brace, skipping string literals
        i, inside = k + 2, False
        while i < len(value):
            if value[i] == "'":
                if inside and value[i + 1:i + 2] == "'":
                    i += 2
                    continue
                inside = not inside
            elif value[i] == "}" and not inside:
                break
            i += 1
        yield value[k + 2:i]
        pos = i + 1


def validate_flow(flow):
    d = flow["properties"]["definition"]
    params = set(d["parameters"])
    names, problems = {}, []

    def walk_actions(acts, path):
        for name, a in acts.items():
            if name in names:
                problems.append(f"duplicate action name {name}")
            names[name] = a
            for dep in a.get("runAfter", {}):
                if dep not in acts:
                    problems.append(f"{name}: runAfter {dep} is not a sibling action")
            for key in ("actions",):
                if key in a:
                    walk_actions(a[key], path + [name])
            if "else" in a:
                walk_actions(a["else"].get("actions", {}), path + [name])

    walk_actions(d["actions"], [])

    def walk_values(v, where):
        if isinstance(v, dict):
            for k, x in v.items():
                if k in ("actions", "else") and isinstance(x, dict):
                    continue
                walk_values(x, where)
        elif isinstance(v, list):
            for x in v:
                walk_values(x, where)
        elif isinstance(v, str):
            for e in expressions_in(v):
                problems.extend(scan_expression(e, where))
                for fn, ref in re.findall(r"\b(outputs|body)\('([^']+)'\)", e):
                    if ref not in names:
                        problems.append(f"{where}: {fn}('{ref}') refers to a missing action")
                for ref in re.findall(r"parameters\('([^']+)'\)", e):
                    if ref not in params:
                        problems.append(f"{where}: parameters('{ref}') is not defined")

    for name, a in names.items():
        walk_values({k: v for k, v in a.items() if k not in ("actions", "else")}, name)
        if a["type"] == "If":
            walk_values(a["expression"], name)
    if problems:
        sys.exit("flow definition problems:\n  " + "\n  ".join(problems))
    return len(names)


# ---------------------------------------------------------------- solution files

def solution_xml(sol, version, flow_id, env_names):
    pub = sol["publisher"]
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

    roots = "".join(f'\n      <RootComponent type="380" schemaName="{n}" behavior="0" />' for n in env_names)
    roots += f'\n      <RootComponent type="29" id="{{{flow_id}}}" behavior="0" />'
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
    <RootComponents>{roots}
    </RootComponents>
    <MissingDependencies />
  </SolutionManifest>
</ImportExportXml>"""


def customizations_xml(cfg, json_path):
    flow = cfg["flow"]
    refs = "".join(f"""
    <connectionreference connectionreferencelogicalname={quoteattr(r['logicalName'])}>
      <connectionreferencedisplayname>{escape(r['displayName'])}</connectionreferencedisplayname>
      <connectorid>/providers/Microsoft.PowerApps/apis/{escape(r['api'])}</connectorid>
      <iscustomizable>1</iscustomizable>
      <promptingbehavior>0</promptingbehavior>
      <statecode>0</statecode>
      <statuscode>1</statuscode>
    </connectionreference>""" for r in cfg["connectionReferences"].values())
    return f"""<ImportExportXml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Entities></Entities>
  <Roles></Roles>
  <Workflows>
    <Workflow WorkflowId="{{{flow['id']}}}" Name={quoteattr(flow['name'])}>
      <JsonFileName>/{json_path}</JsonFileName>
      <Type>1</Type>
      <Subprocess>0</Subprocess>
      <Category>5</Category>
      <Mode>0</Mode>
      <Scope>4</Scope>
      <OnDemand>0</OnDemand>
      <TriggerOnCreate>0</TriggerOnCreate>
      <TriggerOnDelete>0</TriggerOnDelete>
      <AsyncAutodelete>0</AsyncAutodelete>
      <SyncWorkflowLogOnFailure>0</SyncWorkflowLogOnFailure>
      <StateCode>0</StateCode>
      <StatusCode>1</StatusCode>
      <RunAs>1</RunAs>
      <IsTransacted>1</IsTransacted>
      <IntroducedVersion>1.0.0.0</IntroducedVersion>
      <IsCustomizable>1</IsCustomizable>
      <BusinessProcessType>0</BusinessProcessType>
      <IsCustomProcessingStepAllowedForOtherPublishers>1</IsCustomProcessingStepAllowedForOtherPublishers>
      <PrimaryEntity>none</PrimaryEntity>
      <LocalizedNames>
        <LocalizedName languagecode="1033" description={quoteattr(flow['name'])} />
      </LocalizedNames>
      <Descriptions>
        <Description languagecode="1033" description={quoteattr(flow['description'].strip())} />
      </Descriptions>
    </Workflow>
  </Workflows>
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


def env_var_xml(e):
    code, _ = ENV_TYPES[e["type"]]
    default = f"\n  <defaultvalue>{escape(str(e['default']))}</defaultvalue>" if "default" in e else ""
    return f"""<environmentvariabledefinition schemaname="{e['schemaName']}">{default}
  <description default={quoteattr(e['description'])}>
    <label description={quoteattr(e['description'])} languagecode="1033" />
  </description>
  <displayname default={quoteattr(e['displayName'])}>
    <label description={quoteattr(e['displayName'])} languagecode="1033" />
  </displayname>
  <introducedversion>1.0.0.0</introducedversion>
  <iscustomizable>1</iscustomizable>
  <isrequired>0</isrequired>
  <secretstore>0</secretstore>
  <type>{code}</type>
</environmentvariabledefinition>"""


def build(version=None):
    cfg = load_yaml(ROOT / "solution.yml")
    version = version or cfg["version"]
    load_tips()  # validate the library on every build
    parts = template_parts(read_template())
    flow = build_flow(cfg, parts)
    n_actions = validate_flow(flow)

    flow_id = cfg["flow"]["id"].lower()
    json_path = f"Workflows/{re.sub(r'[^A-Za-z0-9]', '', cfg['flow']['name'])}-{flow_id.upper()}.json"
    files = {json_path: json.dumps(flow, indent=2, ensure_ascii=False)}
    envs = cfg["environmentVariables"]
    for e in envs:
        files[f"environmentvariabledefinitions/{e['schemaName']}/environmentvariabledefinition.xml"] = env_var_xml(e)
    files["solution.xml"] = solution_xml(cfg, version, flow_id, [e["schemaName"] for e in envs])
    files["customizations.xml"] = customizations_xml(cfg, json_path)
    files["[Content_Types].xml"] = (
        '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="xml" ContentType="application/octet-stream" />'
        '<Default Extension="json" ContentType="application/octet-stream" /></Types>')

    OUT.mkdir(exist_ok=True)
    (OUT / "FridayCopilotTip.flow.json").write_text(files[json_path], encoding="utf-8")
    zip_path = OUT / f"{cfg['uniqueName']}_{version.replace('.', '_')}.zip"
    order = ["[Content_Types].xml", "solution.xml", "customizations.xml"]
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for p in order + sorted(p for p in files if p not in order):
            z.writestr(p, files[p].encode("utf-8"))
    print(f"Built {zip_path.relative_to(REPO)}: 1 cloud flow ({n_actions} actions), {len(envs)} environment variables, "
          f"{len(cfg['connectionReferences'])} connection references")
    return zip_path


def previews(org="Fortify Cyber", color="#1b2a4a", sign_off="The Copilot Tips Team"):
    """Render every tip as it will look in the inbox, for review before loading the list."""
    parts = template_parts(read_template())
    folder = OUT / "previews"
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True)
    tips = load_tips()
    links, bodies = [], []
    for n, t in enumerate(tips, 1):
        e = lambda s: esc_html(s.strip())
        values = {k: e(t[k]) for k in TIP_COLUMNS if k != "TipSteps"}
        values.update(StepsHtml=steps_html(t["TipSteps"]), OrgName=e(org), SignOff=e(sign_off),
                      BrandColor=color, IssueDate=f"Week {n}", PreviewBanner="")
        name = f"{n:02d}-{re.sub(r'[^a-z0-9]+', '-', t['Title'].lower()).strip('-')}.html"
        page = render_local(parts, values)
        (folder / name).write_text(page, encoding="utf-8")
        body = re.search(r"<body[^>]*>(.*)</body>", page, flags=re.S).group(1)
        bodies.append(f'<h2 style="font-family:Segoe UI,Arial,sans-serif;text-align:center;margin:40px 0 0 0;">'
                      f'Week {n} &middot; {e(t["Subject"])}</h2>{body}')
        links.append(f'<li><a href="{name}">{e(t["Subject"])}</a> <small>({e(t["WorksWith"])})</small></li>')
    (folder / "index.html").write_text(
        "<!DOCTYPE html><meta charset='utf-8'><title>Friday Copilot Tips</title>"
        f"<body style='font-family:Segoe UI,Arial,sans-serif'><h1>Friday Copilot Tips</h1><ol>{''.join(links)}</ol>",
        encoding="utf-8")
    (folder / "all-tips.html").write_text(
        "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
        "<title>Friday Copilot Tips: all emails</title></head>"
        f"<body style='margin:0;background-color:#f3f4f6;color:#1f2933;'>{''.join(bodies)}</body></html>", encoding="utf-8")
    print(f"Rendered {len(tips)} previews to {folder.relative_to(REPO)}/ (index.html, all-tips.html)")


def verify_links():
    """Every LearnUrl must load; every VideoUrl must be a live YouTube video."""
    bad = 0
    for n, t in enumerate(load_tips(), 1):
        checks = [("LearnUrl", t["LearnUrl"])]
        if t["VideoUrl"]:
            checks.append(("VideoUrl", "https://www.youtube.com/oembed?format=json&url="
                           + urllib.parse.quote(t["VideoUrl"], safe="")))
        for col, url in checks:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    status = r.status
                    extra = json.load(r).get("author_name", "") if col == "VideoUrl" else r.url
            except Exception as ex:  # noqa: BLE001
                status, extra = getattr(ex, "code", "ERR"), str(ex)
            ok = status == 200
            bad += not ok
            print(f"{'OK ' if ok else 'BAD'} tip {n:2d} {col}: {status} {extra}")
    if bad:
        sys.exit(f"{bad} link(s) failed")


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
    ap.add_argument("--previews", action="store_true", help="render every tip to out/previews/")
    ap.add_argument("--verify-links", action="store_true", help="check every tip link still resolves")
    args = ap.parse_args()
    z = build(args.version)
    if args.check:
        check(z)
    if args.previews:
        previews()
    if args.verify_links:
        verify_links()
