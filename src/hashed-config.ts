import crypto from "crypto";
import {SwarmAppConfig, SwarmAppServiceConfig} from "./swarm-app-config.js";
import fs from "fs";
import assert, {AssertionError} from "assert";

export class HashedConfig {

    public readonly hash: string;

    public readonly serviceName: string;

    public readonly content: string;

    public readonly targetPath: string;

    public constructor (targetPath: string, content: string, serviceName: string) {
        this.targetPath = targetPath;
        this.content = content;
        this.serviceName = serviceName;
        this.hash = crypto.createHash("md5").update(content).digest("hex");
    }

}

export class HashedConfigs {

    private list: HashedConfig[] = [];

    public add (hashedConfig: HashedConfig) {
        this.list.push(hashedConfig);
    }

    public filterByServiceName (serviceName: string): {targetPath: string; hash: string}[] {
        const service: {targetPath: string; hash: string}[] = [];
        this.list.filter((l) => l.serviceName === serviceName).forEach(({targetPath, hash}) => service.push({targetPath, hash}));
        return service;
    }

    public find (serviceName: string, targetPath: string): HashedConfig {
        const found = this.list.find((l) => l.serviceName === serviceName && l.targetPath === targetPath);
        assert(found != null, `Could not find hashed config ${serviceName} ${targetPath}`);
        return found;
    }

    public unique (): {hash: string; content: string}[] {
        const map = new Map<string, string>();
        const unique: {hash: string; content: string}[] = [];
        this.list.forEach((c) => map.set(c.hash, c.content));
        map.forEach((v, k) => unique.push({hash: k, content: v}));
        return unique;
    }

    public exists (hash: string) {
        return this.list.find((c) => c.hash === hash) != null;
    }

}

async function initHashed (config: SwarmAppConfig, pick: (s: SwarmAppServiceConfig) => Record<string, {source_file?: string; content?: string}> | undefined) {
    const hashedConfigs = new HashedConfigs();
    for (const [serviceName, s] of Object.entries(config.service_specs)) {
        const entries = pick(s);
        if (!entries) continue;
        for (const [targetPath, c] of Object.entries(entries)) {
            let content;
            if (c.content) {
                content = c.content;
            } else if (c.source_file) {
                content = await fs.promises.readFile(c.source_file, "utf-8");
            } else {
                throw new AssertionError({message: `${targetPath} missing content or source_file field`});
            }
            hashedConfigs.add(new HashedConfig(targetPath, content, serviceName));
        }
    }
    return hashedConfigs;
}

export async function initHashedConfigs (config: SwarmAppConfig) {
    return initHashed(config, (s) => s.configs);
}

export async function initHashedSecrets (config: SwarmAppConfig) {
    return initHashed(config, (s) => s.secrets);
}
