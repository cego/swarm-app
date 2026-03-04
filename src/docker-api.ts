import Dockerode, {AuthConfig, ConfigInfo, NetworkInspectInfo, Service} from "dockerode";
import {initServiceSpec, sortServiceSpec} from "./service-spec.js";
import {HashedConfigs} from "./hashed-config.js";
import {assertString} from "./asserts.js";
import {SwarmAppConfig} from "./swarm-app-config.js";
import timers from "timers/promises";
import assert from "assert";

export type NetworkInspectInfoPlus = NetworkInspectInfo & {EnableIPv4: boolean};

export interface DockerResources {
    services: Service[];
    configs: ConfigInfo[];
    networks: NetworkInspectInfoPlus[];
}

export async function getCurrent ({dockerode, appName}: {dockerode: Dockerode; appName: string}): Promise<DockerResources> {
    const resources = {
        configs: await dockerode.listConfigs({filters: {label: [`com.docker.stack.namespace=${appName}`]}}),
        services: await dockerode.listServices({filters: {label: [`com.docker.stack.namespace=${appName}`]}}),
        networks: await dockerode.listNetworks() as NetworkInspectInfoPlus[],
    };
    for (const s of resources.services) {
        sortServiceSpec(s.Spec);
    }
    return resources;
}

interface CreateMissingConfigsOpts {
    dockerode: Dockerode;
    hashedConfigs: HashedConfigs;
    current: DockerResources;
    appName: string;
}
export async function createMissingConfigs ({dockerode, hashedConfigs, appName, current}: CreateMissingConfigsOpts): Promise<ConfigInfo[]> {
    const newConfigs: ConfigInfo[] = [];
    for (const h of hashedConfigs.unique()) {
        const found = current.configs.find((c) => c.Spec?.Name === h.hash);
        if (found) continue;
        console.log(`Creating config with hash ${h.hash}`);
        const spec = {
            Name: h.hash,
            Labels: {"com.docker.stack.namespace": appName},
            Data: Buffer.from(h.content).toString("base64"),
        };
        const {id} = await dockerode.createConfig(spec) as {id: number}; // TODO: Add fix to @types/dockerode
        assertString(id, `id:${id} is not a string in createMissingConfigs`);
        newConfigs.push({ID: id, Spec: spec, CreatedAt: "", UpdatedAt: "", Version: {Index: 0}});
    }
    return newConfigs;
}

interface CreateMissingNetworksOpts {
    dockerode: Dockerode;
    current: DockerResources;
    config: SwarmAppConfig;
    appName: string;
}
export async function createMissingNetworks ({dockerode, current, config, appName}: CreateMissingNetworksOpts): Promise<NetworkInspectInfoPlus[]> {
    if (!config.networks) return [];
    const newNetworks = [];
    for (const n of Object.values(config.networks).filter((e) => !e.external)) {
        let foundNetwork = current.networks.find((c) => c.Name === n.name);
        if (foundNetwork) continue;
        console.log(`Creating network ${n.name}`);
        await dockerode.createNetwork({
            Name: n.name,
            Attachable: n.attachable ?? true,
            Driver: "overlay",
            Labels: {"com.docker.stack.namespace": appName},
        });

        const listNetworks = await dockerode.listNetworks({filters: {label: [`com.docker.stack.namespace=${appName}`]}});
        foundNetwork = listNetworks.find((ln) => ln.Name === n.name) as NetworkInspectInfoPlus | undefined;
        assert(foundNetwork != null, `Network ${n.name} could not be found, it should have just have been created!`);
        newNetworks.push(foundNetwork);
    }
    return newNetworks;
}


interface RemoveUnusedConfigsOpts {
    dockerode: Dockerode;
    current: DockerResources;
    hashedConfigs: HashedConfigs;
}
export async function removeUnusedConfigs ({dockerode, current, hashedConfigs}: RemoveUnusedConfigsOpts) {
    for (const c of current.configs) {
        if (!c.Spec) continue;
        if (hashedConfigs.exists(c.Spec.Name)) continue;
        await dockerode.getConfig(c.ID).remove();
        await timers.setTimeout(0);
    }
}

interface RemoveUnusedServicesOpts {
    dockerode: Dockerode;
    current: DockerResources;
    config: SwarmAppConfig;
    appName: string;
}
export async function removeUnusedServices ({dockerode, current, config, appName}: RemoveUnusedServicesOpts) {
    for (const s of current.services) {
        if (!s.Spec?.Name) continue;
        const serviceShortName = s.Spec.Name.replace(new RegExp(`^${appName}_`), "");
        const serviceSpec = config.service_specs[serviceShortName];
        if (serviceSpec !== undefined) continue;
        console.log(`Removing service ${s.Spec.Name}`);
        await dockerode.getService(s.ID).remove();
    }
}

interface UpsertServicesOpts {
    dockerode: Dockerode;
    config: SwarmAppConfig;
    current: DockerResources;
    appName: string;
    hashedConfigs: HashedConfigs;
    authconfig?: AuthConfig | undefined;
}
export async function upsertServices ({dockerode, config, current, appName, hashedConfigs, authconfig}: UpsertServicesOpts) {
    for (const serviceName of Object.keys(config.service_specs)) {
        const serviceSpec = initServiceSpec({appName, serviceName, config, hashedConfigs, current});
        const foundService = current.services.find((s) => s.Spec?.Name === `${appName}_${serviceName}`);
        if (!foundService) {
            console.log(`Creating service ${appName}_${serviceName}`);
            await dockerode.createService({...serviceSpec, authconfig});
        } else {
            serviceSpec.version = foundService.Version?.Index ?? 0;
            console.log(`Updating service ${appName}_${serviceName}`);
            await dockerode.getService(foundService.ID).update({...serviceSpec, authconfig});
        }
    }
}
