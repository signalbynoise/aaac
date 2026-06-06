import fs from "fs";
import path from "path";

export function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function substituteInTree(dir, replacements) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      substituteInTree(full, replacements);
      continue;
    }
    if (!/\.(md|json|yaml|yml|mdc)$/i.test(entry.name)) continue;
    let text = fs.readFileSync(full, "utf8");
    let changed = false;
    for (const [key, value] of Object.entries(replacements)) {
      const token = `{{${key}}}`;
      if (text.includes(token)) {
        text = text.split(token).join(value);
        changed = true;
      }
    }
    if (changed) fs.writeFileSync(full, text);
  }
}
