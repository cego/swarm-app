import {assertBooleanOrNull, assertString, assertStringOrNull} from "./asserts.js";
import {expandSwarmAppConfig, loadSwarmAppConfig} from "./swarm-app-config.js";
import Dockerode from "dockerode";
import {getCurrent} from "./docker-api.js";
import {initHashedConfigs} from "./hashed-config.js";
import {ArgumentsCamelCase} from "yargs";
import {getAuthForImage, loadDockerConfig} from "./docker-config.js";


export async function initContext (args: ArgumentsCamelCase) {
    const configFile = args.configFile;
    assertString(configFile, "configFile must be string");
    const appName = args.appName;
    assertString(appName, "appName must be a string");
    const injectHostEnv = args.injectHostEnv;
    assertBooleanOrNull(injectHostEnv, "injectHostEnv must be boolean or null");
    const templatingInputFile = args["templating-input-file"];
    assertStringOrNull(templatingInputFile, "templatingInputFile must be a string or null");

    const config = await loadSwarmAppConfig(configFile, true, injectHostEnv, templatingInputFile);
    await expandSwarmAppConfig(config, appName);

    const dockerode = new Dockerode();
    const current = await getCurrent({dockerode, appName});

    const hashedConfigs = await initHashedConfigs(config);

    const dockerConfig = await loadDockerConfig();

    return {appName, config, dockerode, current, hashedConfigs, getAuthForImage: (image: string) => getAuthForImage(image, dockerConfig)};
}
