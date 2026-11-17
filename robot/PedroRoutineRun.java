package org.firstinspires.ftc.teamcode;

import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Scheduler;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;

import org.firstinspires.ftc.teamcode.pedro.Constants;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import static com.pedropathing.ivy.Scheduler.schedule;

/**
 * Runs a routine sent from the Visualizer. During Init, pick one with D-pad
 * up/down; it is checked right away and will not start if anything is wrong.
 */
@Autonomous(name = "Pedro Routine (sent)", group = "Pedro")
public class PedroRoutineRun extends LinearOpMode {

    @Override
    public void runOpMode() {
        Scheduler.reset();
        Follower follower = Constants.create(hardwareMap);
        RobotActions actions = new RobotActions(hardwareMap);
        File[] files = PedroWeb.files();
        SimpleDateFormat time = new SimpleDateFormat("MM-dd HH:mm:ss", Locale.ROOT);

        int index = 0;
        boolean wasUp = false, wasDown = false;
        PedroRoutine routine = null;

        while (opModeInInit()) {
            if (gamepad1.dpad_up && !wasUp && index > 0) { index--; routine = null; }
            if (gamepad1.dpad_down && !wasDown && index < files.length - 1) { index++; routine = null; }
            wasUp = gamepad1.dpad_up;
            wasDown = gamepad1.dpad_down;

            if (files.length == 0) {
                telemetry.addLine("No routines yet. In the Visualizer: Export > Send to robot.");
                telemetry.update();
                sleep(50);
                continue;
            }
            if (routine == null) {
                try {
                    routine = new PedroRoutine(PedroWeb.read(files[index]), follower, RobotActions.HASH, actions::command);
                } catch (Exception e) {
                    routine = new PedroRoutine("{}", follower, RobotActions.HASH, actions::command);
                }
                if (routine.start != null) follower.setPose(routine.start);
            }

            telemetry.addLine("Routines (D-pad up/down):");
            for (int i = 0; i < files.length; i++) {
                telemetry.addLine((i == index ? "> " : "   ") + files[i].getName().replaceAll("\\.json$", "")
                        + "  (" + time.format(new Date(files[i].lastModified())) + ")");
            }
            telemetry.addLine();
            if (routine.problems.isEmpty()) {
                telemetry.addLine(String.format(Locale.ROOT, "READY: %s, %d paths, start x %.1f y %.1f %.0f deg",
                        routine.name, routine.pathCount, routine.start.x(), routine.start.y(),
                        Math.toDegrees(routine.start.heading())));
                telemetry.addLine("Place the robot on the start pose, then press Start.");
            } else {
                telemetry.addLine("DO NOT START, fix this first:");
                for (String problem : routine.problems) telemetry.addLine("- " + problem);
            }
            telemetry.update();
            follower.update();
        }

        if (isStopRequested() || routine == null || !routine.problems.isEmpty()) return;

        schedule(routine.command());
        while (opModeIsActive()) {
            follower.update();
            Scheduler.execute();
            telemetry.addData("routine", routine.name);
            telemetry.addData("x", follower.pose().x());
            telemetry.addData("y", follower.pose().y());
            telemetry.addData("heading", follower.pose().heading());
            telemetry.update();
        }
    }
}
