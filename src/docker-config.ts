import fs from "fs";
import path from "path";
import {AuthConfig} from "dockerode";

export type DockerAuths = Record<string, {auth?: string}>;

export async function loadDockerAuths (): Promise<DockerAuths> {
    const configDir = process.env.DOCKER_CONFIG ?? path.join(process.env.HOME ?? "~", ".docker");
    const configPath = path.join(configDir, "config.json");

    try {
        const content = await fs.promises.readFile(configPath, "utf-8");
        const config = JSON.parse(content) as {auths?: DockerAuths};
        return config.auths ?? {};
    } catch {
        return {};
    }
}

export function resolveAuthConfig (image: string, auths: DockerAuths): AuthConfig | undefined {
    const parts = image.split("/");
    const first = parts[0];
    const registry = parts.length >= 2 && first && (first.includes(".") || first.includes(":")) ? first : "https://index.docker.io/v1/";

    const entry = auths[registry];
    if (!entry?.auth) return undefined;

    const decoded = Buffer.from(entry.auth, "base64").toString("utf-8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) return undefined;

    return {
        username: decoded.substring(0, separatorIndex),
        password: decoded.substring(separatorIndex + 1),
        serveraddress: registry,
    };
}
