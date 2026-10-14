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

Newest first, one line per conversation. Each batch is the newest BATCH emails received before
Before, grouped by conversation; filing a line moves every email of that conversation in the batch.

BatchKey is "Before|NextBefore|RepliedCount,ReadCount|Order|Filed": the batch is the emails
received before Before and on or after NextBefore (the ones shown). Order lists the displayed
lines in order, each as the dot-joined positions of its emails in the batch (1 = newest), e.g.
"1.4,2,3.5"; Filed lists the positions already moved. "file" rebuilds the batch from those times,
checks it still matches (emails shown minus emails filed), and refuses to move anything if it
doesn't, so the agent never handles message or folder ids.

After filing, the same reply lists the next batch (emails received before NextBefore), so working
through a big backlog is one reply per batch. If nothing is left, the key for the list just filed
is returned instead, so the user can still say where its remaining emails go.

Which emails: every read Inbox email that isn't still flagged. A conversation goes under "Replied,
forwarded or completed" when its newest email in the batch was replied to, replied all to or
forwarded (Outlook's PidTagLastVerbExecuted marker), had its flag completed, or was answered later
in the thread; otherwise under "Read, no reply". Selections can say all, replied or read.

Matching and moving run in parallel loops (Copilot Studio waits at most 100 seconds for a flow).
"""
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
CONN = "shared_office365"
CONN_REF = "fc_FilingAssistant.shared_office365.shared-office365-0c11ea16-31cf-4d6b-8706-aa7889bf58e2"
BATCH = 30              # emails per batch (shown grouped by conversation, so usually fewer lines)
SUGGEST_PARALLEL = 10   # conversations matched at once when listing
FILE_PARALLEL = 5       # conversations matched and moved at once when filing
FAR_FUTURE = "2999-12-31T00:00:00Z"
TOP = 1000              # Graph's maximum page size for messages, per query
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
        f"coalesce({email}?['conversationId'], '-'), '''&$select=parentFolderId,receivedDateTime,from,isDraft&$top=100')",
        first_after)
    # Something the user sent in this thread after this email arrived means they dealt with it.
    a[f"{p}Thread_mine"] = {"type": "Query", "runAfter": ok(f"{p}Thread_lookup"), "inputs": {
        "from": f"@coalesce(body('{p}Thread_lookup')?['value'], json('[]'))",
        "where": "@and(not(equals(item()?['isDraft'], true)), "
                 "greater(ticks(coalesce(item()?['receivedDateTime'], '1900-01-01T00:00:00Z')), "
                 f"ticks(coalesce({email}?['receivedDateTime'], '2999-01-01T00:00:00Z'))), "
                 "or(equals(item()?['parentFolderId'], outputs('Sent_id')), "
                 "contains(body('My_addresses'), toLower(coalesce(item()?['from']?['emailAddress']?['address'], '')))))"}}
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
                  f"coalesce(outputs('{p}Name_best')?['name'], ''), '\"')), 'same thread')",
        "kind": f"@if(or(contains(body('Replied_ids'), coalesce({email}?['id'], '-')), "
                f"equals({email}?['flag']?['flagStatus'], 'complete'), "
                f"greater(length(body('{p}Thread_mine')), 0)), 'replied', 'read')"},
        ok(f"{p}Name_folder", f"{p}Thread_mine"))
    return a


def definition():
    A = {}
    # ---- Inputs and variables -------------------------------------------------------------
    A["Mode"] = compose("@toLower(trim(coalesce(triggerBody()?['text'], 'suggest')))", {})
    A["Key_parts"] = compose(
        "@split(if(equals(toLower(trim(coalesce(triggerBody()?['text_1'], ''))), 'none'), '', "
        "trim(coalesce(triggerBody()?['text_1'], ''))), '|')", {})
    # Emails received before this time are considered (file: the batch being filed; next: the batch after).
    A["Before"] = compose(
        f"@if(less(length(outputs('Key_parts')), 4), '{FAR_FUTURE}', "
        "if(equals(outputs('Mode'), 'file'), first(outputs('Key_parts')), first(skip(outputs('Key_parts'), 1))))",
        ok("Mode", "Key_parts"))
    variables = [("Results", "array", []), ("Moved", "array", []), ("Problems", "array", []), ("MovedIdx", "array", []),
                 ("Reply", "string", ""), ("KeyOut", "string", ""), ("ShowList", "boolean", True)]
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
        A[name] = http_get(f"{INBOX}?$filter={flt}&$top={TOP}&$select={SELECT}", ok("Before", inits))
    # Every read Inbox email, newest first before Before (Graph needs the $orderby field first in $filter).
    A["Get_read"] = http_get(
        f"@concat('{INBOX}?$filter=receivedDateTime lt ', outputs('Before'), "
        f"' and isRead eq true&$orderby=receivedDateTime desc&$top={TOP}&$select={SELECT}')", ok("Before", inits))
    A["Read_capped"] = compose("@not(empty(coalesce(body('Get_read')?['@odata.nextLink'], '')))", ok("Get_read"))
    A["All_emails"] = compose(
        "@union(" + ", ".join(f"coalesce(body('{n}')?['value'], json('[]'))" for n in list(gets) + ["Get_read"]) + ")",
        ok(*gets, "Get_read"))
    A["Replied_ids"] = {"type": "Select", "runAfter": ok(*gets), "inputs": {
        "from": "@union(" + ", ".join(f"coalesce(body('{n}')?['value'], json('[]'))"
                                      for n in ["Get_replied", "Get_replied_all", "Get_forwarded"]) + ")",
        "select": "@item()?['id']"}}
    # The user's own address and Sent Items id, to spot their replies in a thread.
    A["Get_sent_sample"] = http_get(
        "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$top=5&$select=from,parentFolderId", ok(inits))
    A["Sent_id"] = compose(
        "@coalesce(first(coalesce(body('Get_sent_sample')?['value'], json('[]')))?['parentFolderId'], '-')",
        ok("Get_sent_sample"))
    A["My_addresses"] = {"type": "Select", "runAfter": ok("Get_sent_sample"), "inputs": {
        "from": "@coalesce(body('Get_sent_sample')?['value'], json('[]'))",
        "select": "@toLower(coalesce(item()?['from']?['emailAddress']?['address'], '-'))"}}
    A["Candidates"] = {"type": "Query", "runAfter": ok("All_emails"), "inputs": {
        "from": "@outputs('All_emails')",
        "where": "@and(equals(item()?['isRead'], true), not(equals(item()?['flag']?['flagStatus'], 'flagged')), "
                 "less(ticks(item()?['receivedDateTime']), ticks(outputs('Before'))))"}}
    # The list to show: in file mode it's the batch after (older than) the one being filed.
    A["Batch_from"] = compose(
        "@if(and(equals(outputs('Mode'), 'file'), greaterOrEquals(length(outputs('Key_parts')), 4)), "
        "first(skip(outputs('Key_parts'), 1)), outputs('Before'))", ok("Before"))
    A["Pool"] = {"type": "Query", "runAfter": ok("Candidates", "Batch_from"), "inputs": {
        "from": "@body('Candidates')",
        "where": "@less(ticks(item()?['receivedDateTime']), ticks(outputs('Batch_from')))"}}
    A["Batch"] = compose(f"@take(reverse(sort(body('Pool'), 'receivedDateTime')), {BATCH})", ok("Pool"))
    A["Remaining"] = compose("@sub(length(body('Pool')), length(outputs('Batch')))", ok("Batch"))
    A["Next_before"] = compose(
        "@coalesce(first(reverse(outputs('Batch')))?['receivedDateTime'], outputs('Batch_from'))", ok("Batch"))
    # Position (1 = newest) and conversation of each batch email, and the batch's conversations.
    A["Batch_indexed"] = {"type": "Select", "runAfter": ok("Batch"), "inputs": {
        "from": "@range(0, length(outputs('Batch')))",
        "select": {"pos": "@add(item(), 1)",
                   "conv": "@coalesce(outputs('Batch')[item()]?['conversationId'], outputs('Batch')[item()]?['id'])",
                   "email": "@outputs('Batch')[item()]"}}}
    A["Batch_convs"] = {"type": "Select", "runAfter": ok("Batch_indexed"), "inputs": {
        "from": "@body('Batch_indexed')", "select": "@item()?['conv']"}}
    A["Convs"] = compose("@union(body('Batch_convs'), body('Batch_convs'))", ok("Batch_convs"))

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
        "foreach": "@range(0, length(outputs('Convs')))",
        "runtimeConfiguration": {"concurrency": {"repetitions": SUGGEST_PARALLEL}},
        "actions": {}}
    # One conversation: its batch emails (newest first); the newest one stands for the conversation.
    loop = {"S_items": {"type": "Query", "runAfter": {}, "inputs": {
        "from": "@body('Batch_indexed')",
        "where": "@equals(item()?['conv'], outputs('Convs')[items('Suggest_each')])"}}}
    loop["S_email"] = compose("@first(body('S_items'))?['email']", ok("S_items"))
    loop.update(match_steps("S_", "outputs('S_email')", ok("S_email")))
    loop["S_names"] = {"type": "Select", "runAfter": ok("S_items"), "inputs": {
        "from": "@body('S_items')", "select": "@coalesce(item()?['email']?['from']?['emailAddress']?['name'], '')"}}
    loop["S_positions"] = {"type": "Select", "runAfter": ok("S_items"), "inputs": {
        "from": "@body('S_items')", "select": "@string(item()?['pos'])"}}
    loop["Append_result"] = {"type": "AppendToArrayVariable",
        "runAfter": ok("S_Suggestion", "S_names", "S_positions"), "inputs": {
        "name": "Results",
        "value": {
            "idx": "@first(body('S_items'))?['pos']",
            "positions": "@join(body('S_positions'), '.')",
            "count": "@length(body('S_items'))",
            "subject": "@replace(replace(coalesce(outputs('S_email')?['subject'], '(no subject)'), '[', '('), ']', ')')",
            "sender": "@join(take(union(body('S_names'), body('S_names')), 3), ', ')",
            "received": "@outputs('S_email')?['receivedDateTime']",
            "link": "@coalesce(outputs('S_email')?['webLink'], '')",
            "folderId": "@outputs('S_Suggestion')?['folderId']",
            "path": "@outputs('S_Suggestion')?['path']",
            "reason": "@outputs('S_Suggestion')?['reason']",
            "kind": "@outputs('S_Suggestion')?['kind']"}}}
    S["Suggest_each"]["actions"] = loop
    # The loop runs in parallel, so results arrive in any order; idx is the conversation's newest
    # email's place in Batch (1 = newest), so sorting by idx lists newest conversations first.
    S["Sug_replied"] = {"type": "Query", "runAfter": ok("Suggest_each"), "inputs": {
        "from": "@variables('Results')",
        "where": "@and(not(empty(item()?['folderId'])), equals(item()?['kind'], 'replied'))"}}
    S["Sug_read"] = {"type": "Query", "runAfter": ok("Suggest_each"), "inputs": {
        "from": "@variables('Results')",
        "where": "@and(not(empty(item()?['folderId'])), not(equals(item()?['kind'], 'replied')))"}}
    S["Not_sure"] = {"type": "Query", "runAfter": ok("Suggest_each"), "inputs": {
        "from": "@variables('Results')", "where": "@empty(item()?['folderId'])"}}
    S["Ordered"] = compose(
        "@union(sort(body('Sug_replied'), 'idx'), sort(body('Sug_read'), 'idx'), sort(body('Not_sure'), 'idx'))",
        ok("Sug_replied", "Sug_read", "Not_sure"))
    S["Numbered"] = {"type": "Select", "runAfter": ok("Ordered"), "inputs": {
        "from": "@range(0, length(outputs('Ordered')))",
        "select": "@addProperty(outputs('Ordered')[item()], 'n', add(item(), 1))"}}
    S["Lines"] = {"type": "Select", "runAfter": ok("Numbered"), "inputs": {
        "from": "@body('Numbered')",
        "select": "@concat('**', string(item()?['n']), '.** [', item()?['subject'], '](', item()?['link'], ') · ', "
                  "item()?['sender'], ' · ', formatDateTime(item()?['received'], 'MMM d'), "
                  "if(greater(item()?['count'], 1), concat(' · *', string(item()?['count']), ' emails*'), ''), "
                  "if(and(empty(item()?['folderId']), not(equals(item()?['kind'], 'replied'))), ' · *read, no reply*', ''), "
                  f"if(empty(item()?['folderId']), '', concat('  ', {NL}, '→ **', item()?['path'], '** · *', "
                  "item()?['reason'], '*')))"}}
    S["Order_list"] = {"type": "Select", "runAfter": ok("Numbered"), "inputs": {
        "from": "@body('Numbered')", "select": "@item()?['positions']"}}
    a_count, b_count = "length(body('Sug_replied'))", "length(body('Sug_read'))"
    s_count, total = f"add({a_count}, {b_count})", "length(body('Numbered'))"
    hint = (f"if(greater({s_count}, 0), concat('Reply **file all** to file ', "
            f"if(equals({s_count}, 1), '1', concat('1–', string({s_count}))), "
            f"if(and(greater({a_count}, 0), greater({b_count}, 0)), concat(', or **file replied only** for ', "
            f"if(equals({a_count}, 1), '1', concat('1–', string({a_count})))), ''), "
            f"'. Or adjust: **file all except 1** · **', string({total}), ' goes to [folder name]** · **skip 2**. "
            f"Nothing moves until you say so.'), 'None of these has a suggested folder. Tell me where any of them go, "
            f"for example **1 goes to [folder name]**. Nothing moves until you say so.')")
    is_file = "equals(outputs('Mode'), 'file')"
    S["Suggest_message"] = compose(
        f"@concat(if({is_file}, concat({NL}, {NL}, '---', {NL}, {NL}), ''), "
        f"'## 📁 Ready to file: ', string(length(outputs('Batch'))), ' emails', "
        f"if(less({total}, length(outputs('Batch'))), concat(' in ', string({total}), ' conversations'), ''), {NL}, {NL}, "
        f"'*', string(length(body('Pool'))), if(outputs('Read_capped'), '+', ''), "
        f"if({is_file}, ' older read emails are', ' read emails in your Inbox are'), "
        f"' ready to file (flagged ones are left out). Showing the newest ', string(length(outputs('Batch'))), "
        f"'; filing a line files the whole conversation.*', {NL}, {NL}, "
        f"if(greater({a_count}, 0), concat('### ✅ Replied, forwarded or completed', {NL}, {NL}, "
        f"join(take(body('Lines'), {a_count}), concat({NL}, {NL})), {NL}, {NL}), ''), "
        f"if(greater({b_count}, 0), concat('### 📖 Read, no reply', {NL}, {NL}, "
        f"join(take(skip(body('Lines'), {a_count}), {b_count}), concat({NL}, {NL})), {NL}, {NL}), ''), "
        f"if(greater(length(body('Not_sure')), 0), concat('### ❓ Not sure', {NL}, {NL}, "
        f"join(skip(body('Lines'), {s_count}), concat({NL}, {NL})), {NL}, {NL}), ''), {hint}, "
        f"if(greater(outputs('Remaining'), 0), concat({NL}, {NL}, string(outputs('Remaining')), "
        f"' older ones are ready after these. When you file, I''ll show the next ones (or say **next** to skip ahead).'), ''))",
        ok("Lines", "Order_list"))
    S["Add_list"] = {"type": "AppendToStringVariable", "runAfter": ok("Suggest_message"),
                     "inputs": {"name": "Reply", "value": "@outputs('Suggest_message')"}}
    S["Set_key_list"] = {"type": "SetVariable", "runAfter": ok("Add_list"), "inputs": {
        "name": "KeyOut",
        "value": f"@concat(outputs('Batch_from'), '|', outputs('Next_before'), '|', "
                 f"string({a_count}), ',', string({b_count}), '|', "
                 "join(body('Order_list'), ','), '|')"}}
    nothing = ("@concat('📁 Nothing is ready to file right now. I list Inbox emails you''ve read, "
               "except ones that are still flagged.')")
    # In file mode with nothing after this batch, KeyOut stays the key of the batch just filed,
    # so the user can still say where its remaining emails go.
    list_section = {"Has_batch": {"type": "If", "runAfter": {},
        "expression": {"and": [{"greater": ["@length(outputs('Batch'))", 0]}]},
        "actions": S,
        "else": {"actions": {"Nothing_left": {"type": "If", "runAfter": {},
            "expression": {"and": [{"equals": ["@outputs('Mode')", "file"]}]},
            "actions": {
                "Add_all_done": {"type": "AppendToStringVariable", "runAfter": {}, "inputs": {
                    "name": "Reply", "value": f"@concat({NL}, {NL}, 'No more emails are ready to file after this list.')"}}},
            "else": {"actions": {
                "Add_none": {"type": "AppendToStringVariable", "runAfter": {},
                             "inputs": {"name": "Reply", "value": nothing}},
                "Set_key_none": {"type": "SetVariable", "runAfter": ok("Add_none"), "inputs": {
                    "name": "KeyOut",
                    "value": "@concat(outputs('Batch_from'), '|', outputs('Batch_from'), '|0||')"}}}}}}}}}

    # ---- File ------------------------------------------------------------------------------
    part = lambda i: f"coalesce(first(skip(outputs('Key_parts'), {i})), '')"
    P = {}
    P["Order"] = compose(f"@split({part(3)}, ',')", {})
    # Field 3 is "replied count,read count": numbers 1..a are replied, a+1..a+b read, the rest Not sure.
    P["Counts"] = compose(f"@split({part(2)}, ',')", ok("Order"))
    first_c, second_c = "coalesce(first(outputs('Counts')), '')", "coalesce(first(skip(outputs('Counts'), 1)), '')"
    P["Replied_count"] = compose(f"@int(if(isInt({first_c}), {first_c}, '0'))", ok("Counts"))
    P["Read_count"] = compose(f"@int(if(isInt({second_c}), {second_c}, '0'))", ok("Replied_count"))
    P["Filed_before"] = {"type": "Query", "runAfter": ok("Read_count"), "inputs": {
        "from": f"@split({part(4)}, ',')", "where": "@not(empty(item()))"}}
    # The batch as it is now: emails before Before (Candidates) and on or after NextBefore, newest first.
    P["Window_items"] = {"type": "Query", "runAfter": ok("Filed_before"), "inputs": {
        "from": "@body('Candidates')",
        "where": f"@greaterOrEquals(ticks(item()?['receivedDateTime']), "
                 f"ticks(if(empty({part(1)}), '{FAR_FUTURE}', {part(1)})))"}}
    P["Window"] = compose("@reverse(sort(body('Window_items'), 'receivedDateTime'))", ok("Window_items"))
    # Every position shown, the ones not filed yet, and position -> index in Window (filed emails
    # have left the Inbox, so the unfiled positions in order are exactly Window's emails in order).
    P["All_positions"] = {"type": "Query", "runAfter": ok("Window"), "inputs": {
        "from": f"@split(replace({part(3)}, '.', ','), ',')", "where": "@isInt(item())"}}
    P["Unfiled"] = {"type": "Query", "runAfter": ok("All_positions"), "inputs": {
        "from": "@body('All_positions')", "where": "@not(contains(body('Filed_before'), item()))"}}
    P["Unfiled_ints"] = {"type": "Select", "runAfter": ok("Unfiled"), "inputs": {
        "from": "@body('Unfiled')", "select": "@int(item())"}}
    P["Unfiled_sorted"] = compose("@sort(body('Unfiled_ints'))", ok("Unfiled_ints"))
    P["Pos_pairs"] = {"type": "Select", "runAfter": ok("Unfiled_sorted"), "inputs": {
        "from": "@range(0, length(outputs('Unfiled_sorted')))",
        "select": "@concat('\"', string(outputs('Unfiled_sorted')[item()]), '\":', string(item()))"}}
    P["Pos_map"] = compose("@json(concat('{', join(body('Pos_pairs'), ','), '}'))", ok("Pos_pairs"))
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
        "from": "@range(1, add(outputs('Replied_count'), outputs('Read_count')))", "select": "@string(item())"}}
    F["Replied_numbers"] = {"type": "Select", "runAfter": {}, "inputs": {
        "from": "@range(1, outputs('Replied_count'))", "select": "@string(item())"}}
    F["Read_numbers"] = {"type": "Select", "runAfter": {}, "inputs": {
        "from": "@range(add(outputs('Replied_count'), 1), outputs('Read_count'))", "select": "@string(item())"}}
    words = "createArray('all', 'replied', 'read')"
    F["Plain_tokens"] = {"type": "Query",
        "runAfter": ok("Tokens_lower", "Override_numbers", "All_numbers", "Replied_numbers", "Read_numbers"), "inputs": {
        "from": "@union(body('Tokens'), "
                "if(contains(body('Tokens_lower'), 'all'), body('All_numbers'), json('[]')), "
                "if(contains(body('Tokens_lower'), 'replied'), body('Replied_numbers'), json('[]')), "
                "if(contains(body('Tokens_lower'), 'read'), body('Read_numbers'), json('[]')))",
        "where": f"@and(not(empty(item())), not(contains({words}, toLower(item()))), not(contains(item(), '=')), "
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
    # The positions of this line's emails, the ones not filed yet, and the newest of those.
    fl["Sel_positions"] = {"type": "Query", "runAfter": ok("Sel_valid"), "inputs": {
        "from": "@split(if(outputs('Sel_valid'), coalesce(first(skip(outputs('Order'), "
                "sub(max(outputs('Sel_number'), 1), 1))), ''), ''), '.')",
        "where": "@isInt(item())"}}
    fl["Sel_todo"] = {"type": "Query", "runAfter": ok("Sel_positions"), "inputs": {
        "from": "@body('Sel_positions')", "where": "@not(contains(body('Filed_before'), item()))"}}
    fl["Sel_filed"] = compose(
        "@and(greater(length(body('Sel_positions')), 0), equals(length(body('Sel_todo')), 0))", ok("Sel_todo"))
    window_at = ("coalesce(first(skip(outputs('Window'), coalesce(outputs('Pos_map')?[{p}], 100000))), json('{{}}'))")
    fl["F_email"] = compose("@" + window_at.format(p="coalesce(first(body('Sel_todo')), '-')"), ok("Sel_filed"))
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
        "@if(not(outputs('Sel_valid')), concat('there''s no number ', string(outputs('Sel_number')), ' in this list'), "
        "if(outputs('Sel_filed'), 'was already filed', "
        "if(not(empty(outputs('Target')?['id'])), '', "
        "if(empty(outputs('Sel_override')), 'has no suggested folder. Tell me where it goes', "
        "if(equals(length(body('Override_matches')), 0), concat('there''s no folder named \"', outputs('Sel_override'), '\"'), "
        "concat('more than one folder is named \"', outputs('Sel_override'), '\". Tell me which one, using its full path'))))))",
        ok("Target"))
    label = ("concat('**', string(outputs('Sel_number')), '.** ', "
             "coalesce(outputs('F_email')?['subject'], ''))")
    k, m = "length(body('Thread_moved'))", "length(body('Sel_todo'))"
    fl["Can_move"] = {"type": "If", "runAfter": ok("Problem"),
        "expression": {"and": [{"equals": ["@outputs('Problem')", ""]}]},
        "actions": {
            # Move every not-yet-filed email of the conversation, one at a time.
            "Move_each": {"type": "Foreach", "runAfter": {}, "foreach": "@body('Sel_todo')",
                "runtimeConfiguration": {"concurrency": {"repetitions": 1}}, "actions": {
                "M_email": compose("@" + window_at.format(p="items('Move_each')"), {}),
                "Move_email": {"type": "OpenApiConnection", "runAfter": ok("M_email"), "inputs": {
                    "host": {"connectionName": CONN, "operationId": "MoveV2",
                             "apiId": f"/providers/Microsoft.PowerApps/apis/{CONN}"},
                    "parameters": {"messageId": "@outputs('M_email')?['id']",
                                   "folderPath": "@concat('Id::', outputs('Target')?['id'])"},
                    "authentication": "@parameters('$authentication')"}},
                # If the connector rejects the Id:: form, move through Graph directly.
                "Move_email_graph": {"type": "OpenApiConnection", "runAfter": {"Move_email": ["Failed"]}, "inputs": {
                    "host": {"connectionName": CONN, "operationId": "HttpRequest",
                             "apiId": f"/providers/Microsoft.PowerApps/apis/{CONN}"},
                    "parameters": {"Uri": "@concat('https://graph.microsoft.com/v1.0/me/messages/', "
                                          "outputs('M_email')?['id'], '/move')",
                                   "Method": "POST",
                                   "Body": "@concat('{\"destinationId\":\"', outputs('Target')?['id'], '\"}')",
                                   "ContentType": "application/json"},
                    "authentication": "@parameters('$authentication')"}},
                "Record_moved_idx": {"type": "AppendToArrayVariable",
                    "runAfter": {"Move_email": ["Succeeded", "Failed"], "Move_email_graph": ["Succeeded", "Skipped"]},
                    "inputs": {"name": "MovedIdx", "value": "@items('Move_each')"}}}},
            # MovedIdx is shared by parallel iterations; this conversation's positions are its own.
            "Thread_moved": {"type": "Query", "runAfter": {"Move_each": ["Succeeded", "Failed"]}, "inputs": {
                "from": "@variables('MovedIdx')", "where": "@contains(body('Sel_todo'), item())"}},
            "Any_moved": {"type": "If", "runAfter": ok("Thread_moved"),
                "expression": {"and": [{"greater": [f"@{k}", 0]}]},
                "actions": {"Record_moved": {"type": "AppendToArrayVariable", "runAfter": {}, "inputs": {
                    "name": "Moved", "value": {
                        "n": "@outputs('Sel_number')",
                        "line": f"@concat('- ', {label}, ' → **', outputs('Target')?['path'], '**', "
                                f"if(equals({k}, {m}), if(greater({k}, 1), concat(' (', string({k}), ' emails)'), ''), "
                                f"concat(' (', string({k}), ' of ', string({m}), ' emails; Outlook couldn''t move the rest)')))"}}}},
                "else": {"actions": {"Record_failed": {"type": "AppendToArrayVariable", "runAfter": {}, "inputs": {
                    "name": "Problems", "value": {
                        "n": "@outputs('Sel_number')",
                        "line": f"@concat('- ', {label}, ': Outlook couldn''t move it')"}}}}}}},
        "else": {"actions": {
            "Record_problem": {"type": "AppendToArrayVariable", "runAfter": {},
                "inputs": {"name": "Problems", "value": {
                    "n": "@outputs('Sel_number')", "line": f"@concat('- ', {label}, ': ', outputs('Problem'))"}}}}}}
    # If anything before the move step fails, say so instead of dropping the number silently.
    fl["Record_error"] = {"type": "AppendToArrayVariable",
        "runAfter": {"Problem": ["Failed", "Skipped", "TimedOut"]},
        "inputs": {"name": "Problems", "value": {
            "n": 9999, "line": "@concat('- ', items('File_each'), ': something went wrong before I could move it. "
                               "Fortify can see why in the flow''s Run history.')"}}}
    F["File_each"] = {"type": "Foreach", "runAfter": ok("Selections"), "foreach": "@outputs('Selections')",
                      "runtimeConfiguration": {"concurrency": {"repetitions": FILE_PARALLEL}}, "actions": fl}
    moved, problems = "length(variables('MovedIdx'))", "length(variables('Problems'))"
    done = {"File_each": ["Succeeded", "Failed"]}
    F["Moved_lines"] = {"type": "Select", "runAfter": done, "inputs": {
        "from": "@sort(variables('Moved'), 'n')", "select": "@item()?['line']"}}
    F["Problem_lines"] = {"type": "Select", "runAfter": done, "inputs": {
        "from": "@sort(variables('Problems'), 'n')", "select": "@item()?['line']"}}
    F["Filed_now"] = compose("@union(body('Filed_before'), variables('MovedIdx'))", done)
    left = "sub(length(body('All_positions')), length(outputs('Filed_now')))"
    F["File_message"] = compose(
        f"@concat(if(greater({moved}, 0), concat('✅ Filed ', string({moved}), if(equals({moved}, 1), ' email.', ' emails.'), "
        f"{NL}, {NL}, join(body('Moved_lines'), {NL})), if(greater({problems}, 0), 'Nothing was moved.', "
        f"concat('Nothing was moved: I didn''t get any numbers to file (I received \"', "
        f"coalesce(triggerBody()?['text_2'], ''), '\"). Try again, for example **5 goes to Archive**.'))), "
        f"if(greater({problems}, 0), concat({NL}, {NL}, '⚠️ Not filed:', {NL}, {NL}, join(body('Problem_lines'), {NL})), ''), "
        f"if(and(greater({left}, 0), greater(length(outputs('Batch')), 0)), concat({NL}, {NL}, '*', string({left}), "
        f"if(equals({left}, 1), ' email', ' emails'), ' from that list stay in your Inbox. Say **Help me file** later "
        f"to go back to them.*'), ''))",
        ok("Moved_lines", "Problem_lines", "Filed_now"))
    F["Add_file_result"] = {"type": "AppendToStringVariable", "runAfter": ok("File_message"),
                            "inputs": {"name": "Reply", "value": "@outputs('File_message')"}}
    F["Set_key_file"] = {"type": "SetVariable", "runAfter": ok("Add_file_result"), "inputs": {
        "name": "KeyOut",
        "value": "@concat(join(take(outputs('Key_parts'), 4), '|'), '|', "
                 "join(outputs('Filed_now'), ','))"}}
    stale = ("@concat('That list has changed since I showed it, or I don''t have it any more, so I didn''t move "
             "anything. Say **Help me file** to see a fresh list.')")
    P["Key_still_valid"] = {"type": "If", "runAfter": ok("Pos_map"),
        "expression": {"and": [
            {"equals": ["@length(outputs('Key_parts'))", 5]},
            {"greater": ["@length(outputs('Order'))", 0]},
            {"greater": ["@length(body('All_positions'))", 0]},
            {"equals": ["@length(outputs('Window'))", "@length(body('Unfiled'))"]}]},
        "actions": F,
        "else": {"actions": {
            "Add_stale": {"type": "AppendToStringVariable", "runAfter": {}, "inputs": {"name": "Reply", "value": stale}},
            "Hide_list": {"type": "SetVariable", "runAfter": ok("Add_stale"),
                          "inputs": {"name": "ShowList", "value": False}}}}}
    file_branch = P

    A["Is_file"] = {"type": "If",
        "runAfter": ok("Remaining", "Next_before", "Convs", "Name_candidates", "Ranks", "Paths", "Read_capped",
                       "Replied_ids", "Sent_id", "My_addresses"),
        "expression": {"and": [{"equals": ["@outputs('Mode')", "file"]}]},
        "actions": file_branch, "else": {"actions": {}}}
    A["Show_list"] = {"type": "If", "runAfter": {"Is_file": ["Succeeded", "Failed"]},
        "expression": {"and": [{"equals": ["@variables('ShowList')", True]}]},
        "actions": list_section, "else": {"actions": {}}}
    A["Add_footer"] = {"type": "AppendToStringVariable", "runAfter": {"Show_list": ["Succeeded", "Failed"]},
                       "inputs": {"name": "Reply", "value": f"@concat({NL}, {NL}, {footer})"}}
    A["Respond_to_the_agent"] = {"type": "Response", "kind": "Skills", "runAfter": ok("Add_footer"), "inputs": {
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
                       "description": "For file: comma-separated numbers from the list (each number is a whole "
                                      "conversation); all for every suggested one; replied or read for just that "
                                      "section; number=Folder name to send one elsewhere, e.g. 1,3,4,5=Cassin. "
                                      "none for suggest."}},
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
