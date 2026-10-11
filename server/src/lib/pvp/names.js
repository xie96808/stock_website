/** Live nickname. Deleted accounts are not copied into the match snapshot. */
export function publicNickname(row) {
  if (!row) return "对手";
  if (row.status === "deleted") return "已注销用户";
  return row.nickname || "对手";
}
