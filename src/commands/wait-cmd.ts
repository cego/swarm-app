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

    const dockerode = new Docker();

    console.log(`Awaiting task reconciliation for ${timeout}ms`);

    const reportedStates = new Map<string, string>();
    let services: Service[], tasks: Task[], timedout, settled, unrecoverable;
    const start = Date.now();
    do {
        // To prevent high cpu usage
        await timers.setTimeout(interval);
        // Calculate timedout
        timedout = Date.now() - timeout > start;

        services = await dockerode.listServices({filters: {label: [`com.docker.stack.namespace=${appName}`]}});
        tasks = await dockerode.listTasks({filters: {"label": [`com.docker.stack.namespace=${appName}`]}}) as Task[];

        settled = true;
        unrecoverable = false;
        for (const s of services) {
            const serviceName = s.Spec?.Name;
            assert(serviceName != null, "serviceName must be a string");
            const updateState = s.UpdateStatus?.State ?? "deployed";
            const stalled = updateState === "paused" || updateState.startsWith("rollback_");
            const runningTasks = tasks.filter((t) => t.Status.State === "running" && t.ServiceID === s.ID);
            const desiredReplicas = s.Spec?.Mode?.Replicated?.Replicas ?? 0;
            const state = !stalled && runningTasks.length < desiredReplicas ? `replicating ${runningTasks.length}/${desiredReplicas}` : updateState;

            if (reportedStates.get(s.ID) !== state) {
                const errMsg = tasks.find((t) => t.ServiceID === s.ID && t.Status.Err)?.Status.Err;
                console.log(`${serviceName} is in ${state} state${errMsg ? ", error: '" + errMsg + "'" : ""}`);
                reportedStates.set(s.ID, state);
            }

            if (stalled) {
                unrecoverable = true;
            } else if (!["deployed", "completed"].includes(state)) {
                settled = false;
            }
        }
    } while (!timedout && !unrecoverable && !settled);

    if (unrecoverable) {
        console.error("This deployment will not complete");
        process.exit(1);
    }

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
    yargs.hide("help");
    yargs.hide("version");
    return yargs;
}
