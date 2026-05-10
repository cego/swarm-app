import {ArgumentsCamelCase, Argv} from "yargs";
import {createMissingConfigs, createMissingNetworks, removeUnusedConfigs, removeUnusedServices, upsertServices} from "../docker-api.js";
import {initContext} from "../context.js";
import timers from "timers/promises";
import yargsExtra from "../yargs-extra.js";

export const command = "deploy <app-name>";
export const description = "Deploys swarm app";

export async function handler (args: ArgumentsCamelCase) {
    const ctx = await initContext(args);
    const dockerode = ctx.dockerode;
    const appName = ctx.appName;

    const addedNetworks = await createMissingNetworks(ctx);
    for (const n of addedNetworks) {
        ctx.current.networks.push(n);
    }
    const addedConfigs = await createMissingConfigs(ctx);
    for (const c of addedConfigs) {
        ctx.current.configs.push(c);
    }
    await upsertServices(ctx);

    await removeUnusedServices(ctx);
    await removeUnusedConfigs(ctx);

    let services;
    let updateStatusesDone;
    do {
        services = await dockerode.listServices({filters: {label: [`com.docker.stack.namespace=${appName}`]}});
        updateStatusesDone = services.every((s) => {
            if (!s.UpdateStatus?.State) return true;
            return ["completed", "rollback_completed", "paused", "rollback_paused"].includes(s.UpdateStatus.State ?? "");
        });

        // To prevent high cpu usage
        await timers.setTimeout(1000);
    } while (!updateStatusesDone);
    const failed = services.filter((s) => {
        return ["paused", "rollback_paused", "rollback_completed"].includes(s.UpdateStatus?.State ?? "");
    });
    if (failed.length > 0) {
        for (const s of failed) {
            console.error(`${s.Spec?.Name} ${s.UpdateStatus?.Message}`);
        }
        console.error("Deployment failed");
        process.exit(1);
    }
    console.error("Deployment succeeded");
}

export function builder (yargs: Argv) {
    yargsExtra.appNameFileOption(yargs);
    yargsExtra.configFileOption(yargs);
    yargsExtra.templateInputOption(yargs);
    yargsExtra.injectHostEnvOption(yargs);
    yargs.hide("help");
    yargs.hide("version");
    return yargs;
}
