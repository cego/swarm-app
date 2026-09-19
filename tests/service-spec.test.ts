import {test, expect} from "@jest/globals";
import {initServiceSpec} from "../src/service-spec.js";
import {HashedConfigs} from "../src/hashed-config.js";
import {SwarmAppConfig} from "../src/swarm-app-config.js";
import {assertTaskTemplateContainerTaskSpec} from "../src/asserts.js";

test("command maps to Args and entrypoint maps to Command", () => {
    const config: SwarmAppConfig = {
        networks: {
            default: {name: "test-network", external: true},
        },
        service_specs: {
            server: {
                image: "cloudflare/cloudflared:2026.3.0",
                entrypoint: ["cloudflared", "--no-autoupdate"],
                command: ["tunnel", "run", "some-uuid"],
                service_labels: {"com.docker.stack.namespace": "test"},
                container_labels: {"com.docker.stack.namespace": "test"},
            },
        },
    };

    const spec = initServiceSpec({
        appName: "test",
        serviceName: "server",
        config,
        hashedConfigs: new HashedConfigs(),
    });

    assertTaskTemplateContainerTaskSpec(spec);
    expect(spec.TaskTemplate.ContainerSpec.Command).toEqual(["cloudflared", "--no-autoupdate"]);
    expect(spec.TaskTemplate.ContainerSpec.Args).toEqual(["tunnel", "run", "some-uuid"]);
});

test("command without entrypoint sets Args only", () => {
    const config: SwarmAppConfig = {
        networks: {
            default: {name: "test-network", external: true},
        },
        service_specs: {
            server: {
                image: "nginx:latest",
                command: ["nginx", "-g", "daemon off;"],
                service_labels: {"com.docker.stack.namespace": "test"},
                container_labels: {"com.docker.stack.namespace": "test"},
            },
        },
    };

    const spec = initServiceSpec({
        appName: "test",
        serviceName: "server",
        config,
        hashedConfigs: new HashedConfigs(),
    });

    assertTaskTemplateContainerTaskSpec(spec);
    expect(spec.TaskTemplate.ContainerSpec.Command).toBeUndefined();
    expect(spec.TaskTemplate.ContainerSpec.Args).toEqual(["nginx", "-g", "daemon off;"]);
});

test("resources map to TaskTemplate.Resources", () => {
    const config: SwarmAppConfig = {
        networks: {
            default: {name: "test-network", external: true},
        },
        service_specs: {
            server: {
                image: "nginx:latest",
                resources: {
                    limits: {nano_cpus: 500000000, memory_bytes: 134217728},
                    reservations: {memory_bytes: 67108864},
                },
                service_labels: {"com.docker.stack.namespace": "test"},
                container_labels: {"com.docker.stack.namespace": "test"},
            },
        },
    };

    const spec = initServiceSpec({
        appName: "test",
        serviceName: "server",
        config,
        hashedConfigs: new HashedConfigs(),
    });

    assertTaskTemplateContainerTaskSpec(spec);
    expect(spec.TaskTemplate.Resources).toEqual({
        Limits: {NanoCPUs: 500000000, MemoryBytes: 134217728},
        Reservations: {MemoryBytes: 67108864},
    });
});
