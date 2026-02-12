import yaml from "js-yaml";
import fs from "fs";
import {AssertionError} from "assert";
import nunjucks from "nunjucks";
import {JTDSchemaType} from "ajv/dist/types/jtd-schema.js";
import Ajv from "ajv/dist/jtd.js";
import {assertObjectOrNull} from "./asserts.js";

export interface SwarmAppNetworkConfig {
    attachable?: boolean;
    external: boolean;
    name: string;
}

export interface SwarmAppEndpointSpecPort {
    protocol?: "tcp" | "udp" | "sctp";
    publish_mode?: "ingress" | "host";
    published_port: number;
    target_port: number;
}

export interface SwarmAppServiceConfig {
    extends?: {file: string; name: string}[];
    image?: string;
    service_labels?: Record<string, string>;
    command?: string[];
    entrypoint?: string[];
    container_labels?: Record<string, string>;
    configs?: Record<string, {
        source_file?: string;
        content?: string;
    }>;
    environment?: Record<string, string>;
    env_file?: string;
    networks?: string[];
    replicas?: number;
    stop_signal?: "SIGTERM" | "SIGQUIT";
    stop_grace_period?: number;
    user?: string;
    placement?: {
        max_replicas_per_node?: number;
        constraints?: string[];
        preferences?: {spread: string}[];
    };
    endpoint_spec?: {
        ports: SwarmAppEndpointSpecPort[];
    };
    health_check?: {
        test?: string[];
        interval?: number;
        timeout?: number;
        retries?: number;
        start_period?: number;
        start_interval?: number;
    };
    dir?: string;
    mounts?: Record<string, {
        source: string;
        type: "bind" | "volume";
        readonly: boolean;
    }>;
    update_config?: {
        parallelism: number;
        order: "stop-first" | "start-first";
    };
}

export interface SwarmAppConfig {
    networks?: Record<string, SwarmAppNetworkConfig>;
    service_specs: Record<string, SwarmAppServiceConfig>;
}


export const swarmAppConfigSchema: JTDSchemaType<SwarmAppConfig> = {
    properties: {
        service_specs: {
            values: {
                optionalProperties: {
                    extends: {
                        elements: {
                            properties: {
                                file: {type: "string"},
                                name: {type: "string"},
                            },
                        },
                    },
                    image: {type: "string"},
                    service_labels: {values: {type: "string"}},
                    command: {elements: {type: "string"}},
                    entrypoint: {elements: {type: "string"}},
                    container_labels: {values: {type: "string"}},
                    configs: {
                        values: {
                            optionalProperties: {
                                source_file: {type: "string"},
                                content: {type: "string"},
                            },
                        },
                    },
                    environment: {values: {type: "string"}},
                    env_file: {type: "string"},
                    networks: {
                        elements: {type: "string"},
                    },
                    replicas: {type: "int32"},
                    stop_signal: {enum: ["SIGTERM", "SIGQUIT"]},
                    stop_grace_period: {type: "float64"},
                    user: {type: "string"},
                    placement: {
                        optionalProperties: {
                            max_replicas_per_node: {type: "int32"},
                            constraints: {elements: {type: "string"}},
                            preferences: {
                                elements: {
                                    properties: {
                                        spread: {type: "string"},
                                    },
                                },
                            },
                        },
                    },
                    endpoint_spec: {
                        properties: {
                            ports: {
                                elements: {
                                    properties: {
                                        published_port: {type: "int16"},
                                        target_port: {type: "int16"},
                                    },
                                    optionalProperties: {
                                        publish_mode: {enum: ["ingress", "host"]},
                                        protocol: {enum: ["tcp", "udp", "sctp"]},
                                    },
                                },
                            },
                        },
                    },
                    health_check: {
                        optionalProperties: {
                            test: {elements: {type: "string"}},
                            interval: {type: "float64"},
                            timeout: {type: "float64"},
                            retries: {type: "int32"},
                            start_period: {type: "float64"},
                            start_interval: {type: "float64"},
                        },
                    },
                    dir: {type: "string"},
                    mounts: {
                        values: {
                            properties: {
                                source: {type: "string"},
                                type: {enum: ["volume", "bind"]},
                                readonly: {type: "boolean"},
                            },
                        },
                    },
                    update_config: {
                        properties: {
                            parallelism: {type: "int32"},
                            order: {enum: ["stop-first", "start-first"]},
                        },
                    },
                },
            },
        },
    },
    optionalProperties: {
        networks: {
            values: {
                properties: {
                    name: {type: "string"},
                    external: {type: "boolean"},
                },
                optionalProperties: {
                    attachable: {type: "boolean"},
                },
            },
        },
    },
};

export async function loadSwarmAppConfig (configFile: string, throwOnUndefined: boolean, injectHostEnv: boolean | null = true, templatingInputFile: string | null) {
    const nunjucksEnv = new nunjucks.Environment(null, {throwOnUndefined});
    const nunjucksEnvInput = injectHostEnv ? {env: process.env} : {};
    const templatingInput = yaml.load(templatingInputFile ? await fs.promises.readFile(templatingInputFile, "utf8") : "---");
    assertObjectOrNull(templatingInput, "templatingInput is not an object or null");
    let configFileContent = await fs.promises.readFile(configFile, "utf8");
    configFileContent = nunjucksEnv.renderString(configFileContent, templatingInput ? {...nunjucksEnvInput, ...templatingInput} : nunjucksEnvInput);
    const swarmAppConfig = yaml.load(configFileContent);

    // Validate json schema
    const validate = new Ajv().compile(swarmAppConfigSchema);
    if (!validate(swarmAppConfig)) {
        throw new AssertionError({message: JSON.stringify(validate.errors)});
    }

    return swarmAppConfig;
}

export function parseEnvFile (src: string): Record<string, string> {
    const regExp = /^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?$/mg;
    const obj: Record<string, string> = {};
    const lines = src.replace(/\r\n?/mg, "\n");

    let match;
    while ((match = regExp.exec(lines)) != null) {
        const key = match[1];
        if (!key) continue;

        let value = match[2] ?? "";

        value = value.trim();

        const maybeQuote = value[0];

        value = value.replace(/^(['"`])([\s\S]*)\1$/mg, "$2");

        if (maybeQuote === "\"") {
            value = value.replace(/\\n/g, "\n");
            value = value.replace(/\\r/g, "\r");
        }

        obj[key] = value;
    }

    return obj;
}

export async function expandSwarmAppConfig (swarmAppConfig: SwarmAppConfig, appName: string) {
    // Create default network block if it's missing.
    if (swarmAppConfig.networks?.default == null) {
        swarmAppConfig.networks = swarmAppConfig.networks ?? {};
        swarmAppConfig.networks.default = {
            name: `${appName}_default`,
            attachable: false,
            external: false,
        };
    }

    // Expand envFile to environment
    for (const s of Object.values(swarmAppConfig.service_specs)) {
        if (!s.env_file) continue;
        const envFileCnt = await fs.promises.readFile(s.env_file, "utf8");
        s.environment = {...s.environment, ...parseEnvFile(envFileCnt)};
        delete s.env_file;
    }

    // Ensure com.docker.stack.namespace labels
    for (const s of Object.values(swarmAppConfig.service_specs)) {
        s.service_labels = s.service_labels ?? {};
        s.service_labels["com.docker.stack.namespace"] = appName;
        s.container_labels = s.container_labels ?? {};
        s.container_labels["com.docker.stack.namespace"] = appName;
    }
}
