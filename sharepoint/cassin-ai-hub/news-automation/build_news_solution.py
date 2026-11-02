#!/usr/bin/env python3
"""Build the Cassin AI Hub weekly news flow into a Dataverse solution zip.

The flow reads Microsoft's Copilot blog feed every Monday, picks articles with the keyword
rules in rules.json, and creates AI Hub news posts: drafts in Review mode, published posts
in Publish mode. Every article it sees is logged in the hub's "AI News Log" list, which also
stops it posting the same article twice. Standard connectors only (RSS, SharePoint, Outlook).

    python3 news-automation/build_news_solution.py            # -> news-automation/out/*.zip
    python3 news-automation/build_news_solution.py --check    # also round-trip through `pac solution unpack`

Settings are environment variables in the solution, so they can be changed in Power Apps
(Solutions -> the solution -> Environment variables) without editing the flow:
mode, reviewer email, hub site URL, feed URL and the keyword rules (JSON).
"""
import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import zipfile
from xml.sax.saxutils import escape, quoteattr

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "out"

SOLUTION = {"uniqueName": "FortifyCassinAINews", "displayName": "Cassin AI Hub News",
            "description": "Weekly flow that posts relevant Microsoft Copilot announcements to the Cassin AI Hub news.",
            "version": "1.0.1.0"}
# Same publisher as the Daily Digest solution, so both sit together in the environment.
PUBLISHER = {"uniqueName": "FortifyCyber", "displayName": "Fortify Cyber", "prefix": "fc", "optionValuePrefix": 83972}

FLOW_ID = "5b0e6c1a-7d2f-4c3e-9a41-0f6b8e2d1c73"
FLOW_NAME = "Cassin AI Hub - Weekly news"

CONN = {  # connection reference logical name per connector
    "shared_rss": ("fc_AINews_sharedrss", "AI Hub News - RSS", "/providers/Microsoft.PowerApps/apis/shared_rss"),
    "shared_sharepointonline": ("fc_AINews_sharedsharepointonline", "AI Hub News - SharePoint",
                                "/providers/Microsoft.PowerApps/apis/shared_sharepointonline"),
    "shared_office365": ("fc_AINews_sharedoffice365", "AI Hub News - Office 365 Outlook",
                         "/providers/Microsoft.PowerApps/apis/shared_office365"),
}

ENV = [  # schema name, display name, default value, description
    ("fc_AINewsMode", "AI News Mode", "Review",
     "Review: news posts are created as unpublished drafts and the reviewer gets an email. "
     "Publish: posts go live automatically."),
    ("fc_AINewsReviewerEmail", "AI News Reviewer Email", "mgalbo@fortifycyber.com",
     "Who gets the weekly email listing what the flow did."),
    ("fc_AINewsHubSiteUrl", "AI Hub Site URL", "https://cassinllp.sharepoint.com/sites/AIHub",
     "The Cassin AI Hub site. Must contain the AI News Log list."),
    ("fc_AINewsFeedUrl", "AI News Feed URL",
     "https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=microsoft-copilot-blog",
     "RSS feed to read: the Microsoft Copilot Blog."),
    ("fc_AINewsRules", "AI News Rules", None,
     "Keyword rules (JSON): skipTitle and skipBody words skip an article; strongWords score 2 each "
     "and apps (case-sensitive) 1 each; minScore is the score needed to post."),
]


def p(schema):
    """The flow's parameter name for an environment variable."""
    name = next(d for s, d, *_ in ENV if s == schema)
    return f"{name} ({schema})"


def P(schema):
    return f"parameters('{p(schema)}')"


def sp_request(method, uri, body=None, after=None, verbose=False, run_after_status=("Succeeded",)):
    """'Send an HTTP request to SharePoint' against the hub site."""
    odata = "verbose" if verbose else "nometadata"
    headers = {"Accept": f"application/json;odata={odata}"}
    if body is not None:
        headers["Content-Type"] = f"application/json;odata={odata}"
    params = {"dataset": f"@{P('fc_AINewsHubSiteUrl')}", "parameters/method": method,
              "parameters/uri": uri, "parameters/headers": headers}
    if body is not None:
        params["parameters/body"] = body
    action = {"type": "OpenApiConnection",
              "inputs": {"host": {"connectionName": "shared_sharepointonline", "operationId": "HttpRequest",
                                  "apiId": CONN["shared_sharepointonline"][2]},
                         "parameters": params, "authentication": "@parameters('$authentication')"},
              "runAfter": {}}
    if after:
        action["runAfter"] = {a: list(run_after_status) for a in ([after] if isinstance(after, str) else after)}
    return action


def compose(value, after=None):
    a = {"type": "Compose", "inputs": value, "runAfter": {}}
    if after:
        a["runAfter"] = {x: ["Succeeded"] for x in ([after] if isinstance(after, str) else after)}
    return a


def query(source, where, after):
    after = [] if after is None else ([after] if isinstance(after, str) else after)
    return {"type": "Query", "inputs": {"from": source, "where": where},
            "runAfter": {x: ["Succeeded"] for x in after}}


def flow_definition():
    title = "outputs('Article')?['title']"
    link = "outputs('Article')?['link']"
    page_id = "body('Create_page')?['d']?['Id']"
    log_uri = "_api/web/lists/GetByTitle('AI%20News%20Log')/items"

    heading = "items('For_each_heading')"
    # Text between the link's '>' and the next '</'. split() never throws, unlike substring() with
    # computed offsets: Power Automate evaluates both branches of if(), so it can't guard them.
    heading_text = f"@{{trim(last(split(first(split({heading}, '</')), '>')))}}"
    post_branch = {
        "Clear_highlights": {"type": "SetVariable", "inputs": {"name": "Highlights", "value": []}, "runAfter": {}},
        # Monthly roundups open with a table of contents, one line per feature (<a href="#community--1-...">).
        # Keep the lines that name one of the firm's apps and none of the skip words, up to four,
        # each linked to its section of Microsoft's article.
        "Is_roundup": {
            "type": "If",
            "expression": {"contains": ["@outputs('Article')?['html']", 'href="#community--1-']},
            "runAfter": {"Clear_highlights": ["Succeeded"]},
            "else": {"actions": {}},
            "actions": {"For_each_heading": {
                "type": "Foreach",
                "foreach": "@skip(split(outputs('Article')?['html'], 'href=\"#community--1-'), 1)",
                "runtimeConfiguration": {"concurrency": {"repetitions": 1}},
                "runAfter": {},
                "actions": {
                    "Heading": compose({"anchor": f"@{{first(split({heading}, '\"'))}}",
                                        "text": heading_text}),
                    "Heading_app_hits": query("@outputs('Rules')?['apps']",
                                              "@contains(outputs('Heading')?['text'], item())", "Heading"),
                    "Heading_skip_hits": query("@outputs('Rules')?['skipTitle']",
                                               "@contains(toLower(outputs('Heading')?['text']), toLower(item()))", "Heading"),
                    "Keep_heading": {
                        "type": "If",
                        "expression": {"and": [{"greater": ["@length(body('Heading_app_hits'))", 0]},
                                               {"equals": ["@length(body('Heading_skip_hits'))", 0]},
                                               {"less": ["@length(variables('Highlights'))", 4]}]},
                        "runAfter": {"Heading_app_hits": ["Succeeded"], "Heading_skip_hits": ["Succeeded"]},
                        "else": {"actions": {}},
                        "actions": {"Add_highlight": {
                            "type": "AppendToArrayVariable",
                            "inputs": {"name": "Highlights",
                                       "value": f"<li><a href=\"@{{{link}}}#community--1-@{{outputs('Heading')?['anchor']}}\">"
                                                "@{outputs('Heading')?['text']}</a></li>"},
                            "runAfter": {}}}},
                }}}},
        # Other articles: Microsoft's first two paragraphs. Blocks with images, or a "paragraph"
        # that is really the whole article (no </P> to split on), are dropped.
        "Paragraph_candidates": {
            "type": "Query",
            "inputs": {"from": "@take(split(outputs('Article')?['html'], '</P>'), 2)",
                       "where": "@and(contains(item(), '<P'), not(contains(toLower(item()), '<img')), less(length(item()), 3000))"},
            "runAfter": {"Is_roundup": ["Succeeded"]}},
        "Paragraph_blocks": {
            "type": "Select",
            "inputs": {"from": "@body('Paragraph_candidates')",
                       "select": "@concat('<P', last(split(item(), '<P')), '</P>')"},
            "runAfter": {"Paragraph_candidates": ["Succeeded"]}},
        "Post_html": compose(
            "@{if(empty(variables('Highlights')), "
            "if(empty(join(body('Paragraph_blocks'), '')), concat('<p>', outputs('Apps_line'), '</p>'), join(body('Paragraph_blocks'), '')), "
            "concat('<p>Highlights for the firm from Microsoft''s monthly Copilot update:</p><ul>', join(variables('Highlights'), ''), '</ul>'))}"
            f"<p><a href=\"@{{{link}}}\"><strong>Read Microsoft's announcement →</strong></a></p>"
            "<p><em>Shared automatically from Microsoft's Copilot blog. Check the source before relying on it, "
            "and follow the firm's AI Acceptable Use Policy.</em></p>"),
        "Page_body": compose({"__metadata": {"type": "SP.Publishing.SitePage"}, "PageLayoutType": "Article",
                              "PromotedState": 1, "Title": f"@{{{title}}}"}, "Post_html"),
        "Create_page": sp_request("POST", "_api/sitepages/pages", "@{string(outputs('Page_body'))}",
                                  "Page_body", verbose=True),
        "Check_out": sp_request("POST", f"_api/sitepages/pages(@{{{page_id}}})/checkoutpage", None,
                                "Create_page", verbose=True),
        "Canvas": compose([
            {"controlType": 4, "id": "@{guid()}", "emphasis": {}, "displayMode": 2,
             "position": {"zoneIndex": 1, "sectionIndex": 1, "controlIndex": 1, "sectionFactor": 12, "layoutIndex": 1},
             "innerHTML": "@{outputs('Post_html')}"},
            {"controlType": 0, "pageSettingsSlice": {"isDefaultDescription": False, "isDefaultThumbnail": True}},
        ]),
        "Save_body": compose({"__metadata": {"type": "SP.Publishing.SitePage"}, "Title": f"@{{{title}}}",
                              "Description": "@{outputs('Apps_line')}",
                              "CanvasContent1": "@{string(outputs('Canvas'))}"}, "Canvas"),
        "Save_page": sp_request("POST", f"_api/sitepages/pages(@{{{page_id}}})/savepageasdraft",
                                "@{string(outputs('Save_body'))}", ["Check_out", "Save_body"], verbose=True),
        "Publish_in_publish_mode": {
            "type": "If", "expression": {"equals": ["@outputs('Mode')", "Publish"]},
            "actions": {"Publish_page": sp_request("POST", f"_api/sitepages/pages(@{{{page_id}}})/publish",
                                                   None, None, verbose=True)},
            "else": {"actions": {}}, "runAfter": {"Save_page": ["Succeeded"]}},
        "Remember_page": {"type": "SetVariable",
                          "inputs": {"name": "PageUrl", "value": "@{body('Create_page')?['d']?['AbsoluteUrl']}"},
                          "runAfter": {"Publish_in_publish_mode": ["Succeeded"]}},
    }
    post_branch["Post_html"]["runAfter"] = {"Paragraph_blocks": ["Succeeded"]}
    post_branch["Canvas"]["runAfter"] = {"Post_html": ["Succeeded"]}
    post_branch["Save_body"]["runAfter"] = {"Canvas": ["Succeeded"]}

    article_actions = {
        "Article": compose({"title": "@{trim(coalesce(items('For_each_article')?['title'], ''))}",
                            "link": "@{coalesce(items('For_each_article')?['primaryLink'], items('For_each_article')?['id'])}",
                            "published": "@{coalesce(items('For_each_article')?['publishDate'], '')}",
                            "html": "@{coalesce(items('For_each_article')?['summary'], '')}"}),
        "Clear_page": {"type": "SetVariable", "inputs": {"name": "PageUrl", "value": ""},
                       "runAfter": {"Article": ["Succeeded"]}},
        "Find_in_log": sp_request(
            "GET", f"{log_uri}?$select=Id&$top=1&$filter=ArticleUrl%20eq%20"
                   f"'@{{encodeUriComponent(replace({link}, '''', ''''''))}}'", None, "Clear_page"),
        "Is_new": {
            "type": "If",
            "expression": {"equals": ["@length(coalesce(body('Find_in_log')?['value'], createArray()))", 0]},
            "runAfter": {"Find_in_log": ["Succeeded"]},
            "else": {"actions": {}},
            "actions": {
                "Text": compose(f"@{{{title}}} @{{outputs('Article')?['html']}}"),
                "Skip_title_hits": query("@outputs('Rules')?['skipTitle']",
                                         f"@contains(toLower({title}), toLower(item()))", "Text"),
                "Skip_body_hits": query("@outputs('Rules')?['skipBody']",
                                        "@contains(toLower(outputs('Text')), toLower(item()))", "Text"),
                "Strong_hits": query("@outputs('Rules')?['strongWords']",
                                     "@contains(toLower(outputs('Text')), toLower(item()))", "Text"),
                "App_hits": query("@outputs('Rules')?['apps']", "@contains(outputs('Text'), item())", "Text"),
                "Score": compose("@add(mul(2, length(body('Strong_hits'))), length(body('App_hits')))",
                                 ["Skip_title_hits", "Skip_body_hits", "Strong_hits", "App_hits"]),
                "Decision": compose(
                    "@if(greater(add(length(body('Skip_title_hits')), length(body('Skip_body_hits'))), 0), 'Skipped', "
                    "if(greaterOrEquals(outputs('Score'), int(coalesce(outputs('Rules')?['minScore'], 2))), "
                    "if(equals(outputs('Mode'), 'Publish'), 'Published', 'Draft'), 'Not relevant'))", "Score"),
                "Reason": compose(
                    "@if(equals(outputs('Decision'), 'Skipped'), "
                    "concat('Skip words: ', join(union(body('Skip_title_hits'), body('Skip_body_hits')), ', ')), "
                    "concat('Score ', string(outputs('Score')), '. Relevance words: ', "
                    "if(empty(body('Strong_hits')), 'none', join(body('Strong_hits'), ', ')), "
                    "'. Apps: ', if(empty(body('App_hits')), 'none', join(body('App_hits'), ', ')), '.'))", "Decision"),
                "Apps_line": compose(
                    "@if(empty(body('App_hits')), 'From Microsoft''s Copilot blog.', "
                    "concat('Microsoft''s announcement covers ', join(body('App_hits'), ', '), '.'))", "Reason"),
                "Should_post": {
                    "type": "If",
                    "expression": {"contains": ["@createArray('Draft', 'Published')", "@outputs('Decision')"]},
                    "runAfter": {"Apps_line": ["Succeeded"]},
                    "actions": post_branch,
                    "else": {"actions": {}},
                },
                "Outcome": compose(
                    "@if(equals(actions('Should_post')?['status'], 'Failed'), 'Error', outputs('Decision'))"),
                "Add_to_report": {"type": "AppendToArrayVariable",
                                  "inputs": {"name": "Report", "value": {
                                      "title": f"@{{{title}}}", "link": f"@{{{link}}}",
                                      "decision": "@{outputs('Outcome')}", "reason": "@{outputs('Reason')}",
                                      "page": "@{variables('PageUrl')}"}},
                                  "runAfter": {"Outcome": ["Succeeded"]}},
                "Log_body": compose({
                    "Title": f"@{{substring({title}, 0, min(length({title}), 250))}}",
                    "ArticleUrl": f"@{{{link}}}",
                    "Score": "@outputs('Score')",
                    "Decision": "@{outputs('Outcome')}",
                    "Reason": "@{outputs('Reason')}",
                    "NewsPage": "@{variables('PageUrl')}",
                    "ArticleDate": "@if(empty(outputs('Article')?['published']), null, outputs('Article')?['published'])",
                }, "Add_to_report"),
                "Log_article": sp_request("POST", log_uri, "@{string(outputs('Log_body'))}", "Log_body"),
            },
        },
    }
    article_actions["Is_new"]["actions"]["Outcome"]["runAfter"] = {"Should_post": ["Succeeded", "Failed"]}
    article_actions["Clear_page"]["runAfter"] = {"Article": ["Succeeded"]}

    row = ("<tr><td style=\"padding:6px;border-bottom:1px solid #ddd\"><a href=\"@{item()?['link']}\">@{item()?['title']}</a></td>"
           "<td style=\"padding:6px;border-bottom:1px solid #ddd\"><b>@{item()?['decision']}</b></td>"
           "<td style=\"padding:6px;border-bottom:1px solid #ddd\">@{if(empty(item()?['page']), '', "
           "concat('<a href=\"', item()?['page'], '\">Open post</a>'))}</td>"
           "<td style=\"padding:6px;border-bottom:1px solid #ddd;color:#555\">@{item()?['reason']}</td></tr>")
    email_body = (
        "<p>@{if(equals(outputs('Mode'), 'Review'), "
        "'The AI Hub news flow ran in <b>Review</b> mode. Posts marked Draft are saved but not published: open each one, check it, then select <b>Publish</b> (or delete it).', "
        "'The AI Hub news flow ran in <b>Publish</b> mode. Posts marked Published are live on the AI Hub.')}</p>"
        "@{if(empty(variables('Report')), '<p>No new articles in Microsoft''s Copilot blog this week.</p>', "
        "concat('<table style=\"border-collapse:collapse;font-size:14px\"><tr><th align=\"left\">Article</th><th align=\"left\">Result</th><th></th><th align=\"left\">Why</th></tr>', "
        "join(body('Report_rows'), ''), '</table>'))}"
        "<p style=\"color:#777;font-size:12px\">To change the keywords, the mode or who gets this email, edit the "
        "environment variables of the Cassin AI Hub News solution in Power Apps. Every article is also logged in "
        "the AI News Log list on the hub.</p>")

    actions = {
        "Rules": compose(f"@json({P('fc_AINewsRules')})"),
        "Mode": compose(f"@if(equals(toLower(trim({P('fc_AINewsMode')})), 'publish'), 'Publish', 'Review')"),
        "Init_report": {"type": "InitializeVariable",
                        "inputs": {"variables": [{"name": "Report", "type": "array", "value": []}]},
                        "runAfter": {"Rules": ["Succeeded"], "Mode": ["Succeeded"]}},
        "Init_page_url": {"type": "InitializeVariable",
                          "inputs": {"variables": [{"name": "PageUrl", "type": "string", "value": ""}]},
                          "runAfter": {"Init_report": ["Succeeded"]}},
        "Init_highlights": {"type": "InitializeVariable",
                            "inputs": {"variables": [{"name": "Highlights", "type": "array", "value": []}]},
                            "runAfter": {"Init_page_url": ["Succeeded"]}},
        "Get_new_articles": {
            "type": "OpenApiConnection",
            "inputs": {"host": {"connectionName": "shared_rss", "operationId": "ListFeedItems",
                                "apiId": CONN["shared_rss"][2]},
                       "parameters": {"feedUrl": f"@{P('fc_AINewsFeedUrl')}",
                                      "since": "@{addDays(utcNow(), -7)}"},
                       "authentication": "@parameters('$authentication')"},
            "runAfter": {"Init_highlights": ["Succeeded"]}},
        "For_each_article": {
            "type": "Foreach", "foreach": "@coalesce(body('Get_new_articles'), createArray())",
            "actions": article_actions,
            "runtimeConfiguration": {"concurrency": {"repetitions": 1}},
            "runAfter": {"Get_new_articles": ["Succeeded"]}},
        "Posted": query("@variables('Report')",
                        "@contains(createArray('Draft', 'Published'), item()?['decision'])", None),
        "Report_rows": {"type": "Select", "inputs": {"from": "@variables('Report')", "select": row},
                        "runAfter": {"Posted": ["Succeeded"]}},
        "Email_reviewer": {
            "type": "If",
            "expression": {"or": [{"equals": ["@outputs('Mode')", "Review"]},
                                  {"greater": ["@length(body('Posted'))", 0]}]},
            "runAfter": {"Report_rows": ["Succeeded"]},
            "else": {"actions": {}},
            "actions": {"Send_email": {
                "type": "OpenApiConnection",
                "inputs": {"host": {"connectionName": "shared_office365", "operationId": "SendEmailV2",
                                    "apiId": CONN["shared_office365"][2]},
                           "parameters": {
                               "emailMessage/To": f"@{P('fc_AINewsReviewerEmail')}",
                               "emailMessage/Subject": "@{if(equals(outputs('Mode'), 'Review'), "
                                                       "concat('AI Hub news: ', string(length(body('Posted'))), ' draft(s) to review'), "
                                                       "concat('AI Hub news: ', string(length(body('Posted'))), ' post(s) published'))}",
                               "emailMessage/Body": email_body,
                               "emailMessage/Importance": "Normal"},
                           "authentication": "@parameters('$authentication')"},
                "runAfter": {}}}},
    }
    actions["Posted"]["runAfter"] = {"For_each_article": ["Succeeded", "Failed"]}

    parameters = {"$connections": {"defaultValue": {}, "type": "Object"},
                  "$authentication": {"defaultValue": {}, "type": "SecureObject"}}
    for schema, name, default, desc in ENV:
        parameters[p(schema)] = {"defaultValue": default if default is not None else rules_json(),
                                 "type": "String", "metadata": {"schemaName": schema, "description": desc}}

    return {
        "properties": {
            "connectionReferences": {
                api: {"runtimeSource": "embedded", "connection": {"connectionReferenceLogicalName": logical},
                      "api": {"name": api}}
                for api, (logical, _, _) in CONN.items()},
            "definition": {
                "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
                "contentVersion": "1.0.0.0",
                "parameters": parameters,
                "triggers": {"Every_Monday_7am": {
                    "type": "Recurrence",
                    "recurrence": {"frequency": "Week", "interval": 1, "timeZone": "Eastern Standard Time",
                                   "schedule": {"weekDays": ["Monday"], "hours": ["7"], "minutes": [0]}}}},
                "actions": actions,
            },
            "templateName": "",
        },
        "schemaVersion": "1.0.0.0",
    }


def rules_json():
    return json.dumps(json.loads((HERE / "rules.json").read_text(encoding="utf-8")), ensure_ascii=False)


def solution_xml():
    nil = lambda tag: f'<{tag} xsi:nil="true"></{tag}>'
    roots = [f'<RootComponent type="29" id="{{{FLOW_ID}}}" behavior="0" />'] + \
            [f'<RootComponent type="380" schemaName="{s}" behavior="0" />' for s, *_ in ENV]
    return f"""<ImportExportXml version="9.2.26031.139" SolutionPackageVersion="9.2" languagecode="1033" generatedBy="CrmLive" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <SolutionManifest>
    <UniqueName>{SOLUTION['uniqueName']}</UniqueName>
    <LocalizedNames>
      <LocalizedName description={quoteattr(SOLUTION['displayName'])} languagecode="1033" />
    </LocalizedNames>
    <Descriptions>
      <Description description={quoteattr(SOLUTION['description'])} languagecode="1033" />
    </Descriptions>
    <Version>{SOLUTION['version']}</Version>
    <Managed>0</Managed>
    <Publisher>
      <UniqueName>{PUBLISHER['uniqueName']}</UniqueName>
      <LocalizedNames>
        <LocalizedName description={quoteattr(PUBLISHER['displayName'])} languagecode="1033" />
      </LocalizedNames>
      <Descriptions />
      {nil('EMailAddress')}
      {nil('SupportingWebsiteUrl')}
      <CustomizationPrefix>{PUBLISHER['prefix']}</CustomizationPrefix>
      <CustomizationOptionValuePrefix>{PUBLISHER['optionValuePrefix']}</CustomizationOptionValuePrefix>
      <Addresses />
    </Publisher>
    <RootComponents>
      {chr(10).join('      ' + r for r in roots).strip()}
    </RootComponents>
    <MissingDependencies />
  </SolutionManifest>
</ImportExportXml>"""


def customizations_xml(flow_file):
    refs = "".join(f"""
    <connectionreference connectionreferencelogicalname={quoteattr(logical)}>
      <connectionreferencedisplayname>{escape(display)}</connectionreferencedisplayname>
      <connectorid>{escape(connector)}</connectorid>
      <iscustomizable>1</iscustomizable>
      <promptingbehavior>0</promptingbehavior>
      <statecode>0</statecode>
      <statuscode>1</statuscode>
    </connectionreference>""" for logical, display, connector in CONN.values())
    return f"""<ImportExportXml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Entities></Entities>
  <Roles></Roles>
  <Workflows>
    <Workflow WorkflowId="{{{FLOW_ID}}}" Name={quoteattr(FLOW_NAME)}>
      <JsonFileName>/Workflows/{flow_file}</JsonFileName>
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
        <LocalizedName languagecode="1033" description={quoteattr(FLOW_NAME)} />
      </LocalizedNames>
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


def env_var_xml(schema, name, default, desc):
    default = default if default is not None else rules_json()
    return f"""<environmentvariabledefinition schemaname="{schema}">
  <defaultvalue>{escape(default)}</defaultvalue>
  <description default={quoteattr(desc)}>
    <label description={quoteattr(desc)} languagecode="1033" />
  </description>
  <displayname default={quoteattr(name)}>
    <label description={quoteattr(name)} languagecode="1033" />
  </displayname>
  <introducedversion>1.0.0.0</introducedversion>
  <iscustomizable>1</iscustomizable>
  <isrequired>0</isrequired>
  <secretstore>0</secretstore>
  <type>100000000</type>
</environmentvariabledefinition>"""


def build():
    OUT.mkdir(exist_ok=True)
    flow_file = f"CassinAIHub-Weeklynews-{FLOW_ID.upper()}.json"
    files = {
        "solution.xml": solution_xml(),
        "customizations.xml": customizations_xml(flow_file),
        f"Workflows/{flow_file}": json.dumps(flow_definition(), indent=2, ensure_ascii=False),
    }
    for schema, name, default, desc in ENV:
        files[f"environmentvariabledefinitions/{schema}/environmentvariabledefinition.xml"] = \
            env_var_xml(schema, name, default, desc)
    files["[Content_Types].xml"] = (
        '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="xml" ContentType="application/octet-stream" />'
        '<Default Extension="json" ContentType="application/octet-stream" /></Types>')
    zip_path = OUT / f"{SOLUTION['uniqueName']}_{SOLUTION['version'].replace('.', '_')}.zip"
    order = ["[Content_Types].xml", "solution.xml", "customizations.xml"]
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for name in order + sorted(k for k in files if k not in order):
            z.writestr(name, files[name].encode("utf-8"))
    print(f"Built {zip_path.relative_to(HERE.parent)}")
    return zip_path


def check(zip_path):
    pac = shutil.which("pac")
    if not pac:
        sys.exit("--check needs the Power Platform CLI (pac) on PATH")
    with tempfile.TemporaryDirectory() as tmp:
        r = subprocess.run([pac, "solution", "unpack", "--zipfile", str(zip_path), "--folder", tmp,
                            "--packagetype", "Unmanaged"], capture_output=True, text=True)
        print(r.stdout[-3000:], r.stderr[-2000:])
        if r.returncode != 0 or "error" in r.stdout.lower():
            sys.exit("pac solution unpack reported a problem")
        print("\n".join(str(f.relative_to(tmp)) for f in sorted(pathlib.Path(tmp).rglob("*")) if f.is_file()))
    print("pac solution unpack: OK")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="validate with `pac solution unpack`")
    args = ap.parse_args()
    z = build()
    if args.check:
        check(z)
