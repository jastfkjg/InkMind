export function backDestinationKey(path: string | null): string {
  if (/^\/novels\/\d+\/write/.test(path || "")) return "workspace_back_write";
  if (/^\/novels\/\d+\/settings/.test(path || "")) return "workspace_back_settings";
  if (/^\/novels\/\d+\/people/.test(path || "")) return "workspace_back_people";
  if (/^\/novels\/\d+\/memos/.test(path || "")) return "workspace_back_memos";
  return "workspace_library";
}
