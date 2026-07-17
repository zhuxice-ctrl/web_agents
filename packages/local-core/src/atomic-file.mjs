import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function isWindowsReplaceConflict(error) {
  return error?.code === "EEXIST" || error?.code === "EPERM";
}

export async function atomicWriteFile(filePath, content, {
  fileSystem = fs,
  idFactory = randomUUID,
} = {}) {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const temporary = path.join(directory, `.${basename}.${idFactory()}.tmp`);
  const recovery = path.join(directory, `.${basename}.${idFactory()}.recovery`);
  await fileSystem.mkdir(directory, { recursive: true });
  await fileSystem.writeFile(temporary, content);
  try {
    await fileSystem.rename(temporary, filePath);
  } catch (firstError) {
    if (!isWindowsReplaceConflict(firstError)) throw firstError;
    await fileSystem.rename(filePath, recovery);
    try {
      await fileSystem.rename(temporary, filePath);
    } catch (installError) {
      try {
        await fileSystem.rename(recovery, filePath);
      } catch (restoreError) {
        const recoveryError = new AggregateError(
          [installError, restoreError],
          `Atomic replacement failed and the original remains at ${recovery}`
        );
        recoveryError.code = "ATOMIC_REPLACE_RESTORE_FAILED";
        recoveryError.recoveryPath = recovery;
        recoveryError.cause = firstError;
        throw recoveryError;
      }
      installError.cause = firstError;
      throw installError;
    }
    await fileSystem.rm(recovery, { force: true });
  } finally {
    await fileSystem.rm(temporary, { force: true }).catch(() => {});
  }
}

export async function atomicWriteJson(filePath, value, options) {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}
