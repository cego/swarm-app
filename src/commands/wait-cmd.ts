import {ArgumentsCamelCase, Argv} from "yargs";
import Docker, {Service} from "dockerode";
import timers from "timers/promises";
import {assertNumber, assertString} from "../asserts.js";
import assert from "assert";
import yargsExtra from "../yargs-extra.js";

interface Task {
    ID: string;
    ServiceID: string;
    Slot: number;
    DesiredState: string;
    Status: {
        State: string;
        Err: string;
    };
}

export const command = "wait <app-name>";
export const description = "Wait for deployment to settle";

export async function handler (args: ArgumentsCamelCase) {
    const appName = args.appName;
    assertString(appName, "appName must be a string");
    const timeout = args.timeout;
    assertNumber(timeout, "timeout must be a number in ms");
    const interval = args.interval;
    assertNumber(interval, "interval must be a number in ms");
    const stableChecks = args.stableChecks;
    assertNumber(stableChecks, "stableChecks must be a number");

    const dockerode = new Docker();

    console.log(`Awaiting task reconciliation for ${timeout}ms`);

    let services: Service[], tasks: Task[], timedout, bail, serviceStateMap;
    let stableStreak = 0;
    const seenFailedTaskIds = new Set<string>();
    const restartCooldown = new Map<string, number>();
    let firstCheck = true;
    const start = Date.now();
    do {
        // To prevent high cpu usage
        await timers.setTimeout(interval);
        // Calculate timedout
        timedout = Date.now() - timeout > start;

        serviceStateMap = new Map<string, string>();
        services = await dockerode.listServices({filters: {label: [`com.docker.stack.namespace=${appName}`]}});
        tasks = await dockerode.listTasks({filters: {"label": [`com.docker.stack.namespace=${appName}`]}}) as Task[];

        for (const s of services) {
            const runningTasks = tasks.filter((t) => t.Status.State === "running" && t.ServiceID === s.ID);
            const desiredReplicas = s.Spec?.Mode?.Replicated?.Replicas ?? 0;

            // Always check replica count first - compare running tasks against desired replicas
            if (runningTasks.length < desiredReplicas) {
                serviceStateMap.set(s.ID, "replicating");
            } else if (s.UpdateStatus?.State && ["updating", "paused", "rollback_started", "rollback_paused"].includes(s.UpdateStatus.State)) {
                serviceStateMap.set(s.ID, s.UpdateStatus.State);
            }
        }

        for (const t of tasks) {
            if (!["failed", "rejected"].includes(t.Status.State) || seenFailedTaskIds.has(t.ID)) {
                continue;
            }
            seenFailedTaskIds.add(t.ID);
            if (!firstCheck) {
                restartCooldown.set(t.ServiceID, stableChecks);
            }
        }
        firstCheck = false;

        for (const [serviceId, remaining] of restartCooldown) {
            serviceStateMap.set(serviceId, "restarting");
            restartCooldown.set(serviceId, remaining - 1);
            if (remaining - 1 <= 0) {
                restartCooldown.delete(serviceId);
            }
        }

        const servicesUpdating = [...serviceStateMap.entries()];

        if (servicesUpdating.length === 0) {
            stableStreak++;
        } else {
            stableStreak = 0;
            for (const [serviceId, state] of servicesUpdating) {
                const serviceName = services.find((s) => s.ID === serviceId)?.Spec?.Name;
                assert(serviceName != null, "serviceName must be a string");
                const errMsg = tasks.find((t) => t.ServiceID === serviceId && t.Status.Err)?.Status.Err;
                console.log(`${serviceName} is in ${state} state${errMsg ? ", error: '" + errMsg + "'" : ""}`);
            }
        }

        bail = stableStreak >= stableChecks;
    } while (!timedout && !bail);

    if (timedout) {
        console.error("Reconciliation timed out");
        process.exit(1);
    }

    console.log("Reconciliation succeeded");
}

export function builder (yargs: Argv) {
    yargsExtra.appNameFileOption(yargs);
    yargs.positional("timeout", {
        type: "number",
        description: "Time is ms to wait for reconciliation",
        default: 120000,
    });
    yargs.positional("interval", {
        type: "number",
        description: "How often reconciliation should run",
        default: 5000,
    });
    yargs.positional("stableChecks", {
        type: "number",
        description: "Consecutive settled checks required before success",
        default: 3,
    });
    yargs.hide("help");
    yargs.hide("version");
    return yargs;
}
