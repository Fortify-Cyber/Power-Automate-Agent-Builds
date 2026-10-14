#!/usr/bin/env python3
"""Generate the "Filing Assistant - Find and file emails" Power Automate flow definition.

The flow does all the mechanical filing work as code, so results are the same every time:
it finds the Inbox emails the user has dealt with, builds the user's folder tree, suggests a
folder for each email (same thread first, then a folder name in the subject), numbers and
formats the list, and moves the emails the user confirms. The Copilot Studio agent only
passes the user's choices through and shows the flow's message.

    python3 filing-agent/workflows/generate_find_and_file.py   # -> FindAndFileEmails.json

Inputs (from the agent):  Mode ("suggest" or "file"), BatchKey, Selections
Outputs (to the agent):   message (Markdown to show as-is), batchkey (pass back on the next call)

BatchKey is "After|NextAfter|SuggestedCount|Order|Filed": the batch is the dealt-with emails
received after After up to NextAfter (the 15 shown); Order maps each displayed number to its
position in that batch, and Filed lists the positions already moved. "file" rebuilds the batch
from those times, checks it still matches (emails shown minus emails filed), and refuses to move
anything if it doesn't, so the agent never handles message or folder ids.
"""
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
CONN = "shared_office365"
CONN_REF = "fc_FilingAssistant.shared_office365.shared-office365-0c11ea16-31cf-4d6b-8706-aa7889bf58e2"
BATCH = 15
NL = "decodeUriComponent('%0A')"
SELECT = "id,subject,from,receivedDateTime,conversationId,webLink,flag,isRead"
INBOX = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages"
REPLIED = "singleValueExtendedProperties/any(ep: ep/id eq 'Integer 0x1081' and cast(ep/value, Edm.Int32) eq {v})"

SYSTEM = ["inbox", "archive", "sent items", "deleted items", "junk email", "drafts", "outbox",
          "conversation history", "sync issues", "rss feeds", "rss subscriptions", "notes", "journal",
          "calendar", "contacts", "tasks", "clutter", "scheduled", "conflicts", "local failures",
          "server failures"]
BLOCKED_ROOTS = ["sent items", "deleted items", "junk email", "drafts", "outbox", "conversation history",
                 "sync issues", "rss feeds", "rss subscriptions", "notes", "journal", "calendar",
                 "contacts", "tasks"]
CLOSED = ["closed", "dead", "deals closed", "closed deals"]


def arr(values):
    return "createArray(" + ", ".join(f"'{v}'" for v in values) + ")"


def norm(expr):
    """Lower-case, turn separators into spaces, collapse double spaces, pad with spaces."""
    e = f"toLower(coalesce({expr}, ''))"
    for ch in ["_", "-", ".", ",", ":", ";", "/", "&", "(", ")", "[", "]", "|"]:
        e = f"replace({e}, '{ch}', ' ')"
    for _ in range(3):
        e = f"replace({e}, '  ', ' ')"
    return f"concat(' ', trim({e}), ' ')"


def json_str(expr):
    """Escape a string for use inside a JSON string built with concat()."""
    return f"replace(replace(coalesce({expr}, ''), '\\', '\\\\'), '\"', '\\\"')"


def http_get(uri_expr, run_after, header=None):
    params = {"Uri": uri_expr, "Method": "GET"}
    if header:
        params["CustomHeader1"] = header
    return {"type": "OpenApiConnection", "runAfter": run_after,
            "inputs": {"host": {"connectionName": CONN, "operationId": "HttpRequest",
                                "apiId": f"/providers/Microsoft.PowerApps/apis/{CONN}"},
                       "parameters": params, "authentication": "@parameters('$authentication')"}}


def compose(value, run_after):
    return {"type": "Compose", "inputs": value, "runAfter": run_after}


def ok(*names):
    return {n: ["Succeeded"] for n in names}


def match_steps(p, email, first_after):
    """Actions that suggest a folder for one email. `email` is an expression for the email object.

    Result: outputs('<p>Suggestion') = {folderId, path, reason}; folderId is '' when Not sure.
    """
    a = {}
    a[f"{p}Thread_lookup"] = http_get(
        f"@concat('https://graph.microsoft.com/v1.0/me/messages?$filter=conversationId eq ''', "
        f"coalesce({email}?['conversationId'], '-'), '''&$select=parentFolderId,receivedDateTime&$top=100')",
        first_after)
    # Rank each thread email: 2 = real folder, 1 = Archive, 0 = anything else (Inbox, Sent Items, ...).
    a[f"{p}Thread_ranked"] = {"type": "Select", "runAfter": ok(f"{p}Thread_lookup"), "inputs": {
        "from": f"@coalesce(body('{p}Thread_lookup')?['value'], json('[]'))",
        "select": {
            "folder": "@item()?['parentFolderId']",
            "rank": "@concat(coalesce(outputs('Ranks')?[coalesce(item()?['parentFolderId'], '-')], '0'), '|', "
                    "coalesce(item()?['receivedDateTime'], ''))"}}}
    a[f"{p}Thread_best"] = compose(f"@first(reverse(sort(body('{p}Thread_ranked'), 'rank')))", ok(f"{p}Thread_ranked"))
    a[f"{p}Thread_folder"] = compose(
        f"@if(startsWith(coalesce(outputs('{p}Thread_best')?['rank'], '0'), '0'), '', "
        f"coalesce(outputs('{p}Thread_best')?['folder'], ''))", ok(f"{p}Thread_best"))
    a[f"{p}Name_matches"] = {"type": "Query", "runAfter": ok(f"{p}Thread_folder"), "inputs": {
        "from": "@body('Name_candidates')",
        "where": f"@contains({norm(email + '?[' + chr(39) + 'subject' + chr(39) + ']')}, item()?['norm'])"}}
    a[f"{p}Name_best"] = compose(f"@first(reverse(sort(body('{p}Name_matches'), 'depth')))", ok(f"{p}Name_matches"))
    a[f"{p}Name_tie"] = {"type": "Query", "runAfter": ok(f"{p}Name_best"), "inputs": {
        "from": f"@body('{p}Name_matches')",
        "where": f"@equals(item()?['depth'], outputs('{p}Name_best')?['depth'])"}}
    a[f"{p}Name_folder"] = compose(
        f"@if(equals(length(body('{p}Name_tie')), 1), coalesce(outputs('{p}Name_best')?['id'], ''), '')",
        ok(f"{p}Name_tie"))
    tf, nf = f"outputs('{p}Thread_folder')", f"outputs('{p}Name_folder')"
    a[f"{p}Suggestion"] = compose({
        "folderId": f"@if(empty({tf}), {nf}, {tf})",
        "path": f"@if(empty({tf}), if(empty({nf}), '', coalesce(outputs('{p}Name_best')?['path'], '')), "
                f"coalesce(outputs('Paths')?[coalesce({tf}, '-')], ''))",
        "reason": f"@if(empty({tf}), if(empty({nf}), '', concat('subject has \"', "
                  f"coalesce(outputs('{p}Name_best')?['name'], ''), '\"')), 'same thread')"},
        ok(f"{p}Name_folder"))
    return a


def definition():
    A = {}
    # ---- Inputs and variables -------------------------------------------------------------
    A["Mode"] = compose("@toLower(trim(coalesce(triggerBody()?['text'], 'suggest')))", {})
    A["Key_parts"] = compose(
        "@split(if(equals(toLower(trim(coalesce(triggerBody()?['text_1'], ''))), 'none'), '', "
        "trim(coalesce(triggerBody()?['text_1'], ''))), '|')", {})
    A["After"] = compose(
        "@if(less(length(outputs('Key_parts')), 4), '1900-01-01T00:00:00Z', "
        "if(equals(outputs('Mode'), 'file'), first(outputs('Key_parts')), first(skip(outputs('Key_parts'), 1))))",
        ok("Mode", "Key_parts"))
    variables = [("Results", "array", []), ("Moved", "array", []), ("Problems", "array", []), ("MovedIdx", "array", []),
                 ("Reply", "string", ""), ("KeyOut", "string", "")]
    prev = None
    for name, typ, val in variables:
        A[f"Init_{name.lower()}"] = {"type": "InitializeVariable", "runAfter": ok(prev) if prev else {},
                                     "inputs": {"variables": [{"name": name, "type": typ, "value": val}]}}
        prev = f"Init_{name.lower()}"
    inits = prev

    # ---- Emails the user has dealt with ---------------------------------------------------
    gets = {"Get_replied": REPLIED.format(v=102), "Get_replied_all": REPLIED.format(v=103),
            "Get_forwarded": REPLIED.format(v=104), "Get_completed": "flag/flagStatus eq 'complete'"}
    for name, flt in gets.items():
        A[name] = http_get(f"{INBOX}?$filter={flt}&$top=250&$select={SELECT}", ok("After", inits))
    A["All_emails"] = compose(
        "@union(" + ", ".join(f"coalesce(body('{n}')?['value'], json('[]'))" for n in gets) + ")", ok(*gets))
    A["Candidates"] = {"type": "Query", "runAfter": ok("All_emails"), "inputs": {
        "from": "@outputs('All_emails')",
        "where": "@and(equals(item()?['isRead'], true), not(equals(item()?['flag']?['flagStatus'], 'flagged')), "
                 "greater(ticks(item()?['receivedDateTime']), ticks(outputs('After'))))"}}
    A["Batch"] = compose(f"@take(sort(body('Candidates'), 'receivedDateTime'), {BATCH})", ok("Candidates"))
    A["Remaining"] = compose("@sub(length(body('Candidates')), length(outputs('Batch')))", ok("Batch"))
    A["Next_after"] = compose(
        "@coalesce(first(reverse(outputs('Batch')))?['receivedDateTime'], outputs('After'))", ok("Batch"))

    # ---- The user's folder tree -----------------------------------------------------------
    A["Get_folders"] = http_get(
        "https://graph.microsoft.com/v1.0/me/mailFolders/delta?$select=displayName,parentFolderId",
        ok(inits), header="Prefer: odata.maxpagesize=500")
    A["Init_folders"] = {"type": "InitializeVariable", "runAfter": ok("Get_folders"), "inputs": {"variables": [
        {"name": "Folders", "type": "array", "value": "@coalesce(body('Get_folders')?['value'], json('[]'))"}]}}
    A["Init_nextlink"] = {"type": "InitializeVariable", "runAfter": ok("Init_folders"), "inputs": {"variables": [
        {"name": "NextLink", "type": "string", "value": "@coalesce(body('Get_folders')?['@odata.nextLink'], '')"}]}}
    A["More_folder_pages"] = {"type": "If", "runAfter": ok("Init_nextlink"),
        "expression": {"and": [{"not": {"equals": ["@variables('NextLink')", ""]}}]},
        "actions": {"Folder_pages": {"type": "Until", "runAfter": {},
            "expression": "@equals(variables('NextLink'), '')", "limit": {"count": 5, "timeout": "PT2M"},
            "actions": {
                "Get_folders_next": http_get("@variables('NextLink')", {}, header="Prefer: odata.maxpagesize=500"),
                "Folders_so_far": compose(
                    "@union(variables('Folders'), coalesce(body('Get_folders_next')?['value'], json('[]')))",
                    ok("Get_folders_next")),
                "Set_folders": {"type": "SetVariable", "runAfter": ok("Folders_so_far"),
                                "inputs": {"name": "Folders", "value": "@outputs('Folders_so_far')"}},
                "Set_nextlink": {"type": "SetVariable", "runAfter": ok("Set_folders"),
                                 "inputs": {"name": "NextLink",
                                            "value": "@coalesce(body('Get_folders_next')?['@odata.nextLink'], '')"}}}}},
        "else": {"actions": {}}}
    # Lookup objects: folder id -> name, folder id -> parent id.
    A["Folder_names"] = {"type": "Select", "runAfter": ok("More_folder_pages"), "inputs": {
        "from": "@variables('Folders')",
        "select": f"@concat('\"', item()?['id'], '\":\"', {json_str(chr(39)*0 + 'item()?[' + chr(39) + 'displayName' + chr(39) + ']')}, '\"')"}}
    A["Folder_parents"] = {"type": "Select", "runAfter": ok("More_folder_pages"), "inputs": {
        "from": "@variables('Folders')",
        "select": "@concat('\"', item()?['id'], '\":\"', coalesce(item()?['parentFolderId'], ''), '\"')"}}
    A["Names"] = compose("@json(concat('{', join(body('Folder_names'), ','), '}'))", ok("Folder_names"))
    A["Parents"] = compose("@json(concat('{', join(body('Folder_parents'), ','), '}'))", ok("Folder_parents"))
    # Walk up to five ancestors, one level per step.
    A["Chain_1"] = {"type": "Select", "runAfter": ok("Names", "Parents"), "inputs": {
        "from": "@variables('Folders')",
        "select": {"id": "@item()?['id']", "name": "@item()?['displayName']",
                   "p1": "@coalesce(item()?['parentFolderId'], '-')"}}}
    for k in range(2, 6):
        sel = {"id": "@item()?['id']", "name": "@item()?['name']"}
        for j in range(1, k):
            sel[f"p{j}"] = f"@item()?['p{j}']"
        sel[f"p{k}"] = f"@coalesce(outputs('Parents')?[item()?['p{k-1}']], '-')"
        A[f"Chain_{k}"] = {"type": "Select", "runAfter": ok(f"Chain_{k-1}"),
                           "inputs": {"from": f"@body('Chain_{k-1}')", "select": sel}}
    N = {j: f"coalesce(outputs('Names')?[item()?['p{j}']], '')" for j in range(1, 6)}
    raw = {j: f"outputs('Names')?[item()?['p{j}']]" for j in range(1, 6)}
    depth = "1"
    for j in range(1, 6):
        depth = f"add({depth}, if(empty({N[j]}), 0, 1))"
    path = "concat(" + ", ".join(f"if(empty({N[j]}), '', concat({N[j]}, ' › '))" for j in range(5, 0, -1)) \
           + ", coalesce(item()?['name'], ''))"
    info = {"id": "@item()?['id']", "name": "@coalesce(item()?['name'], '')", "path": f"@{path}",
            "depth": f"@{depth}",
            "root": "@toLower(coalesce(" + ", ".join(raw[j] for j in range(5, 0, -1)) + ", item()?['name'], ''))"}
    for j in range(1, 6):
        info[f"n{j}"] = f"@toLower({N[j]})"
    A["Folder_info"] = {"type": "Select", "runAfter": ok("Chain_5"),
                        "inputs": {"from": "@body('Chain_5')", "select": info}}
    blocked = f"contains({arr(BLOCKED_ROOTS)}, item()?['root'])"
    system = f"and(equals(item()?['depth'], 1), contains({arr(SYSTEM)}, toLower(item()?['name'])))"
    archive = "and(equals(item()?['depth'], 1), equals(toLower(item()?['name']), 'archive'))"
    closed = "or(" + ", ".join([f"contains({arr(CLOSED)}, toLower(item()?['name']))"] +
                               [f"contains({arr(CLOSED)}, item()?['n{j}'])" for j in range(1, 6)]) + ")"
    numeric = "isInt(replace(item()?['name'], ' ', ''))"
    A["Folders_ready"] = {"type": "Select", "runAfter": ok("Folder_info"), "inputs": {
        "from": "@body('Folder_info')",
        "select": {"id": "@item()?['id']", "name": "@item()?['name']", "path": "@item()?['path']",
                   "depth": "@item()?['depth']", "archive": f"@{archive}",
                   "threadOk": f"@and(not({blocked}), or(not({system}), {archive}))",
                   "nameOk": f"@and(not({blocked}), not({system}), not({closed}), not({numeric}))",
                   "norm": "@" + norm("item()?['name']")}}}
    A["Path_pairs"] = {"type": "Select", "runAfter": ok("Folders_ready"), "inputs": {
        "from": "@body('Folders_ready')",
        "select": f"@concat('\"', item()?['id'], '\":\"', {json_str(chr(39)*0 + 'item()?[' + chr(39) + 'path' + chr(39) + ']')}, '\"')"}}
    A["Paths"] = compose("@json(concat('{', join(body('Path_pairs'), ','), '}'))", ok("Path_pairs"))
    A["Thread_folders"] = {"type": "Query", "runAfter": ok("Folders_ready"), "inputs": {
        "from": "@body('Folders_ready')", "where": "@equals(item()?['threadOk'], true)"}}
    A["Rank_pairs"] = {"type": "Select", "runAfter": ok("Thread_folders"), "inputs": {
        "from": "@body('Thread_folders')",
        "select": "@concat('\"', item()?['id'], '\":\"', if(equals(item()?['archive'], true), '1', '2'), '\"')"}}
    A["Ranks"] = compose("@json(concat('{', join(body('Rank_pairs'), ','), '}'))", ok("Rank_pairs"))
    A["Name_candidates"] = {"type": "Query", "runAfter": ok("Folders_ready"), "inputs": {
        "from": "@body('Folders_ready')", "where": "@equals(item()?['nameOk'], true)"}}

    footer = "'*Filing Assistant v@@VERSION@@*'"

    # ---- Suggest -------------------------------------------------------------------------
    S = {}
    S["Suggest_each"] = {"type": "Foreach", "runAfter": {},
        "foreach": "@range(0, length(outputs('Batch')))",
        "runtimeConfiguration": {"concurrency": {"repetitions": 1}},
        "actions": {}}
    loop = {"S_email": compose("@outputs('Batch')[items('Suggest_each')]", {})}
    loop.update(match_steps("S_", "outputs('S_email')", ok("S_email")))
    loop["Append_result"] = {"type": "AppendToArrayVariable", "runAfter": ok("S_Suggestion"), "inputs": {
        "name": "Results",
        "value": {
            "idx": "@add(items('Suggest_each'), 1)",
            "subject": "@replace(replace(coalesce(outputs('S_email')?['subject'], '(no subject)'), '[', '('), ']', ')')",
            "sender": "@coalesce(outputs('S_email')?['from']?['emailAddress']?['name'], '')",
            "received": "@outputs('S_email')?['receivedDateTime']",
            "link": "@coalesce(outputs('S_email')?['webLink'], '')",
            "folderId": "@outputs('S_Suggestion')?['folderId']",
            "path": "@outputs('S_Suggestion')?['path']",
            "reason": "@outputs('S_Suggestion')?['reason']"}}}
    S["Suggest_each"]["actions"] = loop
    S["Suggested"] = {"type": "Query", "runAfter": ok("Suggest_each"), "inputs": {
        "from": "@variables('Results')", "where": "@not(empty(item()?['folderId']))"}}
    S["Not_sure"] = {"type": "Query", "runAfter": ok("Suggest_each"), "inputs": {
        "from": "@variables('Results')", "where": "@empty(item()?['folderId'])"}}
    S["Ordered"] = compose("@union(sort(body('Suggested'), 'received'), sort(body('Not_sure'), 'received'))",
                           ok("Suggested", "Not_sure"))
    S["Numbered"] = {"type": "Select", "runAfter": ok("Ordered"), "inputs": {
        "from": "@range(0, length(outputs('Ordered')))",
        "select": "@addProperty(outputs('Ordered')[item()], 'n', add(item(), 1))"}}
    S["Lines"] = {"type": "Select", "runAfter": ok("Numbered"), "inputs": {
        "from": "@body('Numbered')",
        "select": "@concat('**', string(item()?['n']), '.** [', item()?['subject'], '](', item()?['link'], ') · ', "
                  "item()?['sender'], ' · ', formatDateTime(item()?['received'], 'MMM d'), "
                  f"if(empty(item()?['folderId']), '', concat('  ', {NL}, '→ **', item()?['path'], '** · *', "
                  "item()?['reason'], '*')))"}}
    S["Order_list"] = {"type": "Select", "runAfter": ok("Numbered"), "inputs": {
        "from": "@body('Numbered')", "select": "@string(item()?['idx'])"}}
    s_count, total = "length(body('Suggested'))", "length(body('Numbered'))"
    hint = (f"if(greater({s_count}, 0), concat('Reply **file all** to file ', "
            f"if(equals({s_count}, 1), '1', concat('1–', string({s_count}))), "
            f"', or adjust: **file all except 1** · **', string({total}), ' goes to [folder name]** · **skip 2**. "
            f"Nothing moves until you say so.'), 'None of these has a suggested folder. Tell me where any of them go, "
            f"for example **1 goes to [folder name]**. Nothing moves until you say so.')")
    S["Suggest_message"] = compose(
        f"@concat('## 📁 Ready to file: ', string({total}), ' emails', {NL}, {NL}, "
        f"'*', string(length(body('Candidates'))), ' emails in your Inbox are ready to file (you replied, forwarded, "
        f"or completed the flag). Showing the oldest ', string({total}), '.*', {NL}, {NL}, "
        f"join(take(body('Lines'), {s_count}), concat({NL}, {NL})), "
        f"if(greater(length(body('Not_sure')), 0), concat({NL}, {NL}, '### ❓ Not sure', {NL}, {NL}, "
        f"join(skip(body('Lines'), {s_count}), concat({NL}, {NL}))), ''), {NL}, {NL}, {hint}, "
        f"if(greater(outputs('Remaining'), 0), concat({NL}, {NL}, string(outputs('Remaining')), "
        f"' more are ready after this batch. Say **next** when you''re done with these.'), ''), {NL}, {NL}, {footer})",
        ok("Lines", "Order_list"))
    S["Set_reply_list"] = {"type": "SetVariable", "runAfter": ok("Suggest_message"),
                           "inputs": {"name": "Reply", "value": "@outputs('Suggest_message')"}}
    S["Set_key_list"] = {"type": "SetVariable", "runAfter": ok("Set_reply_list"), "inputs": {
        "name": "KeyOut",
        "value": f"@concat(outputs('After'), '|', outputs('Next_after'), '|', string({s_count}), '|', "
                 "join(body('Order_list'), ','), '|')"}}
    nothing = (f"@concat('📁 Nothing is ready to file right now. I suggest Inbox emails you''ve replied to, "
               f"forwarded, or flagged and marked complete.', {NL}, {NL}, {footer})")
    suggest_branch = {"Has_batch": {"type": "If", "runAfter": {},
        "expression": {"and": [{"greater": ["@length(outputs('Batch'))", 0]}]},
        "actions": S,
        "else": {"actions": {
            "Set_reply_none": {"type": "SetVariable", "runAfter": {}, "inputs": {"name": "Reply", "value": nothing}},
            "Set_key_none": {"type": "SetVariable", "runAfter": ok("Set_reply_none"), "inputs": {
                "name": "KeyOut", "value": "@concat(outputs('After'), '|', outputs('After'), '|0||')"}}}}}}

    # ---- File ------------------------------------------------------------------------------
    part = lambda i: f"coalesce(first(skip(outputs('Key_parts'), {i})), '')"
    P = {}
    P["Order"] = compose(f"@split({part(3)}, ',')", {})
    P["Suggested_count"] = compose(f"@int(if(isInt({part(2)}), {part(2)}, '0'))", ok("Order"))
    P["Filed_before"] = {"type": "Query", "runAfter": ok("Suggested_count"), "inputs": {
        "from": f"@split({part(4)}, ',')", "where": "@not(empty(item()))"}}
    P["Window_items"] = {"type": "Query", "runAfter": ok("Filed_before"), "inputs": {
        "from": "@body('Candidates')",
        "where": f"@lessOrEquals(item()?['receivedDateTime'], {part(1)})"}}
    P["Window"] = compose("@sort(body('Window_items'), 'receivedDateTime')", ok("Window_items"))
    F = {}
    F["Tokens"] = {"type": "Select", "runAfter": {}, "inputs": {
        "from": "@split(coalesce(triggerBody()?['text_2'], ''), ',')", "select": "@trim(item())"}}
    F["Tokens_lower"] = {"type": "Select", "runAfter": ok("Tokens"), "inputs": {
        "from": "@body('Tokens')", "select": "@toLower(item())"}}
    F["Override_tokens"] = {"type": "Query", "runAfter": ok("Tokens"), "inputs": {
        "from": "@body('Tokens')", "where": "@contains(item(), '=')"}}
    F["Override_numbers"] = {"type": "Select", "runAfter": ok("Override_tokens"), "inputs": {
        "from": "@body('Override_tokens')", "select": "@trim(first(split(item(), '=')))"}}
    F["All_numbers"] = {"type": "Select", "runAfter": {}, "inputs": {
        "from": "@range(1, outputs('Suggested_count'))", "select": "@string(item())"}}
    F["Plain_tokens"] = {"type": "Query", "runAfter": ok("Tokens_lower", "Override_numbers", "All_numbers"), "inputs": {
        "from": "@union(body('Tokens'), if(contains(body('Tokens_lower'), 'all'), body('All_numbers'), json('[]')))",
        "where": "@and(not(empty(item())), not(equals(toLower(item()), 'all')), not(contains(item(), '=')), "
                 "not(contains(body('Override_numbers'), item())))"}}
    F["Selections"] = compose("@union(body('Override_tokens'), body('Plain_tokens'))", ok("Plain_tokens"))
    fl = {}
    fl["Sel_number"] = compose(
        "@int(if(isInt(trim(first(split(items('File_each'), '=')))), trim(first(split(items('File_each'), '='))), '0'))", {})
    fl["Sel_override"] = compose(
        "@if(contains(items('File_each'), '='), toLower(trim(last(split(items('File_each'), '=')))), '')",
        ok("Sel_number"))
    fl["Sel_valid"] = compose(
        "@and(greater(outputs('Sel_number'), 0), lessOrEquals(outputs('Sel_number'), length(outputs('Order'))))",
        ok("Sel_override"))
    # Position of this email in the batch as shown, then in the batch as it is now (minus filed ones).
    fl["Sel_original"] = compose(
        "@int(if(outputs('Sel_valid'), coalesce(first(skip(outputs('Order'), sub(max(outputs('Sel_number'), 1), 1))), '0'), '0'))",
        ok("Sel_valid"))
    fl["Sel_filed"] = compose("@contains(body('Filed_before'), string(outputs('Sel_original')))", ok("Sel_original"))
    fl["Filed_earlier"] = {"type": "Query", "runAfter": ok("Sel_filed"), "inputs": {
        "from": "@body('Filed_before')", "where": "@less(int(item()), outputs('Sel_original'))"}}
    fl["F_email"] = compose(
        "@coalesce(if(and(outputs('Sel_valid'), not(outputs('Sel_filed'))), first(skip(outputs('Window'), "
        "sub(max(sub(outputs('Sel_original'), length(body('Filed_earlier'))), 1), 1))), null), json('{}'))",
        ok("Filed_earlier"))
    fl.update(match_steps("F_", "outputs('F_email')", ok("F_email")))
    fl["Override_matches"] = {"type": "Query", "runAfter": ok("F_Suggestion"), "inputs": {
        "from": "@body('Folders_ready')",
        "where": "@and(equals(item()?['threadOk'], true), or(equals(toLower(item()?['name']), outputs('Sel_override')), "
                 "equals(toLower(item()?['path']), outputs('Sel_override'))))"}}
    ov_one = "equals(length(body('Override_matches')), 1)"
    fl["Target"] = compose({
        "id": f"@if(empty(outputs('Sel_override')), outputs('F_Suggestion')?['folderId'], "
              f"if({ov_one}, first(body('Override_matches'))?['id'], ''))",
        "path": f"@if(empty(outputs('Sel_override')), outputs('F_Suggestion')?['path'], "
                f"if({ov_one}, first(body('Override_matches'))?['path'], ''))"}, ok("Override_matches"))
    fl["Problem"] = compose(
        "@if(not(outputs('Sel_valid')), concat('there''s no email ', string(outputs('Sel_number')), ' in this list'), "
        "if(outputs('Sel_filed'), 'was already filed', "
        "if(not(empty(outputs('Target')?['id'])), '', "
        "if(empty(outputs('Sel_override')), 'has no suggested folder. Tell me where it goes', "
        "if(equals(length(body('Override_matches')), 0), concat('there''s no folder named \"', outputs('Sel_override'), '\"'), "
        "concat('more than one folder is named \"', outputs('Sel_override'), '\". Tell me which one, using its full path'))))))",
        ok("Target"))
    label = ("concat('**', string(outputs('Sel_number')), '.** ', "
             "coalesce(outputs('F_email')?['subject'], ''))")
    fl["Can_move"] = {"type": "If", "runAfter": ok("Problem"),
        "expression": {"and": [{"equals": ["@outputs('Problem')", ""]}]},
        "actions": {
            "Move_email": {"type": "OpenApiConnection", "runAfter": {}, "inputs": {
                "host": {"connectionName": CONN, "operationId": "MoveV2",
                         "apiId": f"/providers/Microsoft.PowerApps/apis/{CONN}"},
                "parameters": {"messageId": "@outputs('F_email')?['id']",
                               "folderPath": "@concat('Id::', outputs('Target')?['id'])"},
                "authentication": "@parameters('$authentication')"}},
            # If the connector rejects the Id:: form, move through Graph directly.
            "Move_email_graph": {"type": "OpenApiConnection", "runAfter": {"Move_email": ["Failed"]}, "inputs": {
                "host": {"connectionName": CONN, "operationId": "HttpRequest",
                         "apiId": f"/providers/Microsoft.PowerApps/apis/{CONN}"},
                "parameters": {"Uri": "@concat('https://graph.microsoft.com/v1.0/me/messages/', "
                                      "outputs('F_email')?['id'], '/move')",
                               "Method": "POST",
                               "Body": "@concat('{\"destinationId\":\"', outputs('Target')?['id'], '\"}')",
                               "ContentType": "application/json"},
                "authentication": "@parameters('$authentication')"}},
            "Record_moved": {"type": "AppendToArrayVariable",
                "runAfter": {"Move_email": ["Succeeded", "Failed"], "Move_email_graph": ["Succeeded", "Skipped"]},
                "inputs": {"name": "Moved", "value": f"@concat('- ', {label}, ' → **', outputs('Target')?['path'], '**')"}},
            "Record_moved_idx": {"type": "AppendToArrayVariable", "runAfter": ok("Record_moved"),
                "inputs": {"name": "MovedIdx", "value": "@string(outputs('Sel_original'))"}},
            "Record_failed": {"type": "AppendToArrayVariable",
                "runAfter": {"Move_email_graph": ["Failed", "TimedOut"]},
                "inputs": {"name": "Problems", "value": f"@concat('- ', {label}, ': Outlook couldn''t move it')"}}},
        "else": {"actions": {
            "Record_problem": {"type": "AppendToArrayVariable", "runAfter": {},
                "inputs": {"name": "Problems", "value": f"@concat('- ', {label}, ': ', outputs('Problem'))"}}}}}
    F["File_each"] = {"type": "Foreach", "runAfter": ok("Selections"), "foreach": "@outputs('Selections')",
                      "runtimeConfiguration": {"concurrency": {"repetitions": 1}}, "actions": fl}
    moved, problems = "length(variables('Moved'))", "length(variables('Problems'))"
    F["File_message"] = compose(
        f"@concat(if(greater({moved}, 0), concat('✅ Filed ', string({moved}), if(equals({moved}, 1), ' email.', ' emails.'), "
        f"{NL}, {NL}, join(variables('Moved'), {NL})), 'Nothing was moved.'), "
        f"if(greater({problems}, 0), concat({NL}, {NL}, '⚠️ Not filed:', {NL}, {NL}, join(variables('Problems'), {NL})), ''), "
        f"{NL}, {NL}, 'Say **next** for the next batch.', {NL}, {NL}, {footer})",
        {"File_each": ["Succeeded", "Failed"]})
    F["Set_reply_file"] = {"type": "SetVariable", "runAfter": ok("File_message"),
                           "inputs": {"name": "Reply", "value": "@outputs('File_message')"}}
    F["Set_key_file"] = {"type": "SetVariable", "runAfter": ok("Set_reply_file"), "inputs": {
        "name": "KeyOut",
        "value": "@concat(join(take(outputs('Key_parts'), 4), '|'), '|', "
                 "join(union(body('Filed_before'), variables('MovedIdx')), ','))"}}
    stale = (f"@concat('That list has changed since I showed it, or I don''t have it any more, so I didn''t move "
             f"anything. Say **Help me file** to see a fresh list.', {NL}, {NL}, {footer})")
    P["Key_still_valid"] = {"type": "If", "runAfter": ok("Window"),
        "expression": {"and": [
            {"equals": ["@length(outputs('Key_parts'))", 5]},
            {"greater": ["@length(outputs('Order'))", 0]},
            {"equals": ["@add(length(outputs('Window')), length(body('Filed_before')))", "@length(outputs('Order'))"]}]},
        "actions": F,
        "else": {"actions": {
            "Set_reply_stale": {"type": "SetVariable", "runAfter": {}, "inputs": {"name": "Reply", "value": stale}}}}}
    file_branch = P

    A["Is_file"] = {"type": "If",
        "runAfter": ok("Remaining", "Next_after", "Name_candidates", "Ranks", "Paths"),
        "expression": {"and": [{"equals": ["@outputs('Mode')", "file"]}]},
        "actions": file_branch, "else": {"actions": suggest_branch}}
    A["Respond_to_the_agent"] = {"type": "Response", "kind": "Skills", "runAfter": ok("Is_file"), "inputs": {
        "statusCode": 200,
        "schema": {"type": "object", "properties": {
            "message": {"title": "message", "x-ms-dynamically-added": True, "type": "string"},
            "batchkey": {"title": "batchkey", "x-ms-dynamically-added": True, "type": "string"}}},
        "body": {"message": "@variables('Reply')", "batchkey": "@variables('KeyOut')"}}}

    trigger = {"manual": {"type": "Request", "kind": "Skills", "inputs": {"schema": {
        "type": "object",
        "properties": {
            "text": {"title": "Mode", "type": "string", "x-ms-dynamically-added": True,
                     "x-ms-content-hint": "TEXT",
                     "description": "suggest to list emails ready to file; file to move the emails the user confirmed"},
            "text_1": {"title": "BatchKey", "type": "string", "x-ms-dynamically-added": True,
                       "x-ms-content-hint": "TEXT",
                       "description": "The batchkey from the previous result, copied exactly. none for a new Help me file."},
            "text_2": {"title": "Selections", "type": "string", "x-ms-dynamically-added": True,
                       "x-ms-content-hint": "TEXT",
                       "description": "For file: comma-separated numbers from the list, all for every suggested one, "
                                      "and number=Folder name to send one elsewhere, e.g. 1,3,4,5=Cassin. none for suggest."}},
        # All required: Copilot Studio only lists a flow's optional inputs if someone adds them by hand.
        "required": ["text", "text_1", "text_2"]}}}}

    return {"$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
            "contentVersion": "1.0.0.0",
            "parameters": {"$connections": {"defaultValue": {}, "type": "Object"},
                           "$authentication": {"defaultValue": {}, "type": "SecureObject"}},
            "triggers": trigger, "actions": A, "outputs": {}}


def main():
    flow = {"properties": {
        "connectionReferences": {CONN: {
            # "invoker" = "Provided by run-only user": each person's own Outlook connection.
            "runtimeSource": "invoker",
            "connection": {"connectionReferenceLogicalName": CONN_REF},
            "api": {"name": CONN}}},
        "definition": definition(),
        "templateName": None},
        "schemaVersion": "1.0.0.0"}
    out = HERE / "FindAndFileEmails.json"
    out.write_text(json.dumps(flow, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {out.relative_to(HERE.parent.parent)}")


if __name__ == "__main__":
    main()
