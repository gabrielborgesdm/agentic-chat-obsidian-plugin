import type { OperationRecord } from "../types";
import type { VaultService } from "../vault/VaultService";

/**
 * Safe rollback of a recorded operation. Refuses when the note changed after
 * the operation, so it can never clobber newer work.
 */
export async function rollbackOperation(op: OperationRecord, vault: VaultService): Promise<string> {
  if (op.rolledBack) return "Already rolled back.";
  switch (op.kind) {
    case "create": {
      const cur = await vault.read(op.path);
      if (op.after !== undefined && cur.content !== op.after) {
        throw new Error("The note was edited after it was created; not removing it.");
      }
      await vault.trash(op.path);
      return `Removed ${op.path} (moved to trash).`;
    }
    case "update":
    case "append": {
      const cur = await vault.read(op.path);
      if (cur.content !== op.after) throw new Error("The note changed after this edit; cannot roll back safely.");
      await vault.update(op.path, op.before ?? "");
      return `Restored previous content of ${op.path}.`;
    }
    case "rename": {
      if (!op.oldPath) throw new Error("No previous path recorded.");
      await vault.rename(op.path, op.oldPath);
      return `Renamed back to ${op.oldPath}.`;
    }
    case "delete": {
      await vault.create(op.path, op.before ?? "");
      return `Restored ${op.path}.`;
    }
  }
}
