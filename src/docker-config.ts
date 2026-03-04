import fs from "fs";
import path from "path";
import {AuthConfig} from "dockerode";

type DockerConfigAuths = Record<string, {auth?: string}>;

interface DockerConfigFile {
    auths?: DockerConfigAuths;
}

function extractRegistry (image: string): string {
    const parts = image.split("/");
    const first = parts[0];
    if (parts.length >= 2 && first && (first.includes(".") || first.includes(":"))) {
        return first;
    }
    return "https://index.docker.io/v1/";
}

export function getAuthForImage (image: string, dockerConfig: DockerConfigFile): AuthConfig | undefined {
    if (!dockerConfig.auths) return undefined;

    const registry = extractRegistry(image);
    const entry = dockerConfig.auths[registry];
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

export async function loadDockerConfig (): Promise<DockerConfigFile> {
    const configDir = process.env.DOCKER_CONFIG ?? path.join(process.env.HOME ?? "~", ".docker");
    const configPath = path.join(configDir, "config.json");

    try {
        const content = await fs.promises.readFile(configPath, "utf-8");
        return JSON.parse(content) as DockerConfigFile;
    } catch {
        return {};
    }
}
