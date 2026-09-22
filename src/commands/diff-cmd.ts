import {ArgumentsCamelCase, Argv} from "yargs";
import {SwarmAppConfig} from "../swarm-app-config.js";
import {DockerResources, NetworkInspectInfoPlus} from "../docker-api.js";
import {HealthConfig, NetworkInspectInfo, ServiceSpec} from "dockerode";
import {diffStringsRaw, diffStringsUnified} from "jest-diff";
import yaml from "js-yaml";
import {initServiceSpec} from "../service-spec.js";
import {HashedConfigs} from "../hashed-config.js";
import {initContext} from "../context.js";
import fs from "fs/promises";
import {nameCompare} from "../array.js";
import yargsExtra from "../yargs-extra.js";
import {assertTaskTemplateContainerTaskSpec} from "../asserts.js";

export const command = "diff <app-name>";
export const description = "Show diff between current and config";

interface InitNetworkResourcesOpt {
    appName: string;
    config: SwarmAppConfig;
}
function initNetworkResources ({config, appName}: InitNetworkResourcesOpt): NetworkInspectInfoPlus[] {
    const networkInfos: NetworkInspectInfoPlus[] = [];
    const internalNetworks = Object.values(config.networks ?? {}).filter((n) => !n.external);

    for (const n of internalNetworks) {
        networkInfos.push({
            Name: n.name,
            Id: "",
            Created: "1970-01-01T06:00:00.00000000",
            Scope: "swarm",
            Driver: "overlay",
            EnableIPv4: true,
            EnableIPv6: false,
            IPAM: {Driver: "default"},
            Internal: false,
            Attachable: n.attachable ?? true,
            Ingress: false,
            ConfigOnly: false,
            Labels: {
                "com.docker.stack.namespace": appName,
            },
        });
    }
    return networkInfos.sort(nameCompare);
}

interface InitServiceResourcesOpt {
    appName: string;
    config: SwarmAppConfig;
    hashedConfigs: HashedConfigs;
    hashedSecrets: HashedConfigs;
    current: DockerResources;
}
function initServiceResources ({appName, config, hashedConfigs, hashedSecrets, current}: InitServiceResourcesOpt): ServiceSpec[] {
    const serviceSpecs: ServiceSpec[] = [];
    for (const serviceName of Object.keys(config.service_specs)) {
        const serviceSpec = initServiceSpec({appName, serviceName, config, hashedConfigs, hashedSecrets, current});
        delete serviceSpec.version;
        serviceSpecs.push(serviceSpec);
    }
    return serviceSpecs.sort(nameCompare);
}

interface DiffEntry {
    services: (ServiceSpec | undefined)[];
    networks: (NetworkInspectInfo & {EnableIPv4: boolean} | undefined)[];
}
function deleteIrrelevantNetworkFields (entry: DiffEntry) {
    for (const n of entry.networks) {
        delete n?.IPAM?.Options;
        delete n?.IPAM?.Config;
        delete n?.ConfigFrom;
        delete n?.Containers;
        delete n?.Options;
        if (n) {
            n.Id = "<masked>";
            n.Created = "<masked>";
        }
    }

    for (const s of entry.services) {
        assertTaskTemplateContainerTaskSpec(s);

        // Delete config id, we don't care about it
        for (const c of s.TaskTemplate.ContainerSpec.Configs ?? []) {
            delete c.ConfigID;
        }
        // Delete secret id, we don't care about it
        for (const c of s.TaskTemplate.ContainerSpec.Secrets ?? []) {
            delete c.SecretID;
        }
    }
}
function fixLhsInconsistencies (entry: DiffEntry) {
    // For some reason Healthcheck comes out of dockerode, but HealthCheck is used as service spec.
    for (const s of entry.services) {
        assertTaskTemplateContainerTaskSpec(s);

        // @ts-expect-error Healthcheck shouldn't exist on ContainerSpec, it should be HealthCheck
        s.TaskTemplate.ContainerSpec.HealthCheck = s.TaskTemplate.ContainerSpec.Healthcheck as HealthConfig | undefined;
        // @ts-expect-error Healthcheck shouldn't exist on ContainerSpec, it should be HealthCheck
        delete s.TaskTemplate.ContainerSpec.Healthcheck;
    }
}

function filterAppNetworks (network: NetworkInspectInfo, appName: string) {
    if (!network.Labels) return false;
    return network.Labels["com.docker.stack.namespace"] === appName;
}

export async function handler (args: ArgumentsCamelCase) {
    const ctx = await initContext(args);

    const lhs: DiffEntry = {
        networks: ctx.current.networks.filter((n) => filterAppNetworks(n, ctx.appName)).sort(nameCompare),
        services: ctx.current.services.map((s) => s.Spec).sort(nameCompare),
    };
    const rhs: DiffEntry = {
        networks: initNetworkResources(ctx),
        services: initServiceResources(ctx),
    };

    deleteIrrelevantNetworkFields(lhs);
    deleteIrrelevantNetworkFields(rhs);

    fixLhsInconsistencies(lhs);

    const lhsTxt = yaml.dump(lhs);
    const rhsTxt = yaml.dump(rhs);
    if (args["write-lhs-rhs"]) {
        await fs.writeFile("lhs.yml", lhsTxt);
        await fs.writeFile("rhs.yml", rhsTxt);
    }
    const diffs = diffStringsRaw(lhsTxt, rhsTxt, true);
    if (diffs.length === 1 && diffs[0]?.["0"] === 0) {
        console.log("No changes detected");
        return;
    }

    const red = (str: string) => `\x1b[31m${str}\x1b[0m`;
    const green = (str: string) => `\x1b[32m${str}\x1b[0m`;
    const comparison = diffStringsUnified(lhsTxt, rhsTxt, {
        omitAnnotationLines: true,
        expand: false,
        aColor: red,
        bColor: green,
    });
    console.log(comparison);
}

export function builder (yargs: Argv) {
    yargsExtra.appNameFileOption(yargs);
    yargsExtra.configFileOption(yargs);
    yargsExtra.templateInputOption(yargs);
    yargsExtra.injectHostEnvOption(yargs);
    yargs.option("write-lhs-rhs", {
        type: "boolean",
        description: "Write lhs and rhs files",
        demandOption: false,
        default: false,
        alias: "w",
    });
    yargs.hide("help");
    yargs.hide("version");
    return yargs;
}
