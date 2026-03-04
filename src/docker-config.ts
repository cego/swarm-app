import fs from "fs";
import path from "path";
import {AuthConfig} from "dockerode";

export async function loadAuthConfig (): Promise<AuthConfig | undefined> {
    const configDir = process.env.DOCKER_CONFIG ?? path.join(process.env.HOME ?? "~", ".docker");
    const configPath = path.join(configDir, "config.json");

    let content: string;
    try {
        content = await fs.promises.readFile(configPath, "utf-8");
    } catch {
        return undefined;
    }

    const config = JSON.parse(content) as {auths?: Record<string, {auth?: string}>};
    const firstEntry = Object.entries(config.auths ?? {}).find(([, v]) => v.auth);
    if (!firstEntry) return undefined;

    const [serveraddress, entry] = firstEntry;
    if (!entry.auth) return undefined;
    const decoded = Buffer.from(entry.auth, "base64").toString("utf-8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) return undefined;

    return {
        username: decoded.substring(0, separatorIndex),
        password: decoded.substring(separatorIndex + 1),
        serveraddress,
    };
}
