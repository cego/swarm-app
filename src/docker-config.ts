import fs from "fs";
import path from "path";
import {AuthConfig, AuthConfigObject} from "dockerode";

export async function loadDockerAuths (): Promise<Record<string, AuthConfigObject>> {
    const configDir = process.env.DOCKER_CONFIG ?? path.join(process.env.HOME ?? "~", ".docker");
    const configPath = path.join(configDir, "config.json");

    try {
        const content = await fs.promises.readFile(configPath, "utf-8");
        const config = JSON.parse(content) as {auths?: Record<string, AuthConfigObject>};
        return config.auths ?? {};
    } catch {
        return {};
    }
}

export function resolveAuthConfig (image: string, auths: Record<string, AuthConfigObject>): AuthConfig | undefined {
    const parts = image.split("/");
    const first = parts[0];
    const registry = parts.length >= 2 && first && (first.includes(".") || first.includes(":")) ? first : "https://index.docker.io/v1/";

    const entry = auths[registry];
    if (!entry?.auth) return undefined;

    return {auth: entry.auth, serveraddress: registry};
}
