import assert from "assert";
import {SwarmAppConfig} from "./swarm-app-config.js";
import {HashedConfigs} from "./hashed-config.js";
import {DockerResources} from "./docker-api.js";
import {ServiceSpec} from "dockerode";
import {sortObjectKeys} from "./object.js";
import {assertTaskTemplateContainerTaskSpec} from "./asserts.js";

export function sortServiceSpec (s: ServiceSpec | undefined) {
    assertTaskTemplateContainerTaskSpec(s);

    if (s.Labels) {
        s.Labels = sortObjectKeys(s.Labels);
    }
    if (s.TaskTemplate.ContainerSpec.Labels) {
        s.TaskTemplate.ContainerSpec.Labels = sortObjectKeys(s.TaskTemplate.ContainerSpec.Labels);
    }
    s.TaskTemplate.ContainerSpec.Env?.sort((a, b) => {
        return a.localeCompare(b);
    });
    s.TaskTemplate.ContainerSpec.Configs?.sort((a, b) => {
        if (!a.File?.Name) return 0;
        if (!b.File?.Name) return 0;
        return a.File.Name.localeCompare(b.File.Name);
    });
}

interface InitServiceSpecOpts {
    appName: string;
    serviceName: string;
    config: SwarmAppConfig;
    hashedConfigs: HashedConfigs;
    current?: DockerResources;
}

export function initServiceSpec ({appName, serviceName, config, hashedConfigs, current}: InitServiceSpecOpts): ServiceSpec & {version?: number} {
    assert(config.service_specs[serviceName], "config.service_specs[serviceName] must be non-null");
    const serviceConfig = config.service_specs[serviceName];

    let env;
    if (serviceConfig.environment) {
        env = Object.entries(serviceConfig.environment ?? {}).map(([k, v]) => `${k}=${v}`).sort((a, b) => a.localeCompare(b));
    }

    let configs;
    const byServiceName = hashedConfigs.filterByServiceName(serviceName);
    if (byServiceName.length > 0) {
        configs = byServiceName.map(({targetPath, hash}) => {
            return {
                File: {Name: targetPath, UID: "0", GID: "0", Mode: 0},
                ConfigID: current?.configs.find((c) => c.Spec?.Name === hash)?.ID,
                ConfigName: hash,
            };
        });
    }

    let updateConfig;
    if (serviceConfig.update_config) {
        updateConfig = {
            Parallelism: serviceConfig.update_config.parallelism,
            FailureAction: "pause",
            MaxFailureRatio: 0,
            Order: serviceConfig.update_config.order,
        };
    }

    const serviceSpec: ServiceSpec & {version?: number; TaskTemplate: {ContainerSpec: {HealthCheck: {StartInterval: number | undefined}}}} = {
        version: 0,
        Name: `${appName}_${serviceName}`,
        Labels: serviceConfig.service_labels,
        TaskTemplate: {
            ContainerSpec: {
                Image: serviceConfig.image,
                Labels: serviceConfig.container_labels,
                Command: serviceConfig.command,
                Env: env,
                StopSignal: serviceConfig.stop_signal,
                StopGracePeriod: serviceConfig.stop_grace_period,
                User: serviceConfig.user,
                Configs: configs,
                Isolation: "default",
                Dir: serviceConfig.dir,
                HealthCheck: {
                    Test: serviceConfig.health_check?.test,
                    Interval: serviceConfig.health_check?.interval,
                    Timeout: serviceConfig.health_check?.timeout,
                    StartPeriod: serviceConfig.health_check?.start_period,
                    StartInterval: serviceConfig.health_check?.start_interval,
                    Retries: serviceConfig.health_check?.retries,
                },
            },
            Placement: {
                Constraints: serviceConfig.placement?.constraints,
                Preferences: serviceConfig.placement?.preferences?.map((p) => {
                    return {Spread: {SpreadDescriptor: p.spread}};
                }),
                MaxReplicas: serviceConfig.placement?.max_replicas_per_node,
            },
            Networks: serviceConfig.networks?.map((networkKey) => {
                assert(config.networks != null, "config.networks cannot be empty here");
                const network = config.networks[networkKey];
                assert(network != null, `config.networks[${networkKey}] cannot be empty here`);
                const foundNetwork = current?.networks.find((n) => n.Name === network.name);
                return {Target: foundNetwork?.Id};
            }),
            ForceUpdate: 0,
            Runtime: "container",
        },
        Mode: {Replicated: {Replicas: serviceConfig.replicas ?? 1}},
        UpdateConfig: updateConfig,
        EndpointSpec: {
            Mode: "vip",
            Ports: serviceConfig.endpoint_spec?.ports.map((p) => {
                return {Protocol: p.protocol, TargetPort: p.target_port, PublishedPort: p.published_port, PublishMode: p.publish_mode};
            }),
        },
    };
    sortServiceSpec(serviceSpec);
    return serviceSpec;
}
