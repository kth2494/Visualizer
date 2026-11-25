# Send to robot: robot side

Copy these into `TeamCode/src/main/java/org/firstinspires/ftc/teamcode/`
once, together with `RobotActions.java` from the Visualizer
(Export > Send to robot > Save RobotActions.java), then install the app.

- `PedroWeb.java` receives routines on the Robot Controller web server
  (`http://192.168.43.1:8080/pedro`) and keeps them in `FIRST/pedro/routines`.
  It also hands a saved routine back, for **Load from robot** in the Visualizer.
- `PedroRoutine.java` rebuilds the paths with the same Pedro calls the
  sequential export writes.
- `PedroRoutineRun.java` is the "Pedro Routine (sent)" OpMode: pick a routine
  with D-pad up/down during Init.

Needs Pedro 3, `com.pedropathing.ivy:core` and `:pedro` 1.1.1, and
`org.firstinspires.ftc.teamcode.pedro.Constants`. Reinstall only when robot
actions change; the OpMode refuses to start until RobotActions matches.
