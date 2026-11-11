package org.firstinspires.ftc.teamcode

import com.pedropathing.api.Paths.*
import com.pedropathing.api.Paths
import com.pedropathing.api.PoseFactory
import com.pedropathing.follower.Follower
import com.pedropathing.math.Pose
import com.pedropathing.paths.Path
import com.pedropathing.ivy.Command
import com.pedropathing.ivy.Scheduler
import com.pedropathing.ivy.Scheduler.schedule
import com.pedropathing.ivy.commands.Commands.*
import com.pedropathing.ivy.groups.Groups.sequential
import com.pedropathing.ivy.pedro.PedroCommands.follow
import com.qualcomm.robotcore.eventloop.opmode.Autonomous
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode

@Autonomous(name = "AutoPath", group = "Autonomous")
class AutoPath : LinearOpMode() {

    private lateinit var follower: Follower

    private val poseFactory = PoseFactory.degrees()

    private val start = poseFactory.of(86.27, 8.0, 90.0)
    private val path1 = poseFactory.of(85.82, 13.22, 70.0)
    private val path2Start = poseFactory.of(85.82, 13.22, 70.0)
    private val path2 = poseFactory.of(97.34, 34.4, 0.0)
    private val path3Start = poseFactory.of(97.34, 34.4, 0.0)
    private val path3 = poseFactory.of(124.0, 34.4, 0.0)
    private val path4Start = poseFactory.of(124.0, 34.4, 0.0)
    private val path4 = poseFactory.of(85.82, 13.22, 70.0)
    private val path5Start = poseFactory.of(85.82, 13.22, 70.0)
    private val path5 = poseFactory.of(90.97, 19.1, 90.0)

    // Autonomous routine
    fun autoRoutine(): Command = sequential(
            follow(follower, path1()),
            follow(follower, path2()),
            follow(follower, path3()),
            follow(follower, path4()),
            follow(follower, path5())
    )

    override fun runOpMode() {
        Scheduler.reset()
        follower = Constants.create(hardwareMap)
        follower.setPose(start)
        follower.update()

        waitForStart()
        schedule(autoRoutine())

        while (opModeIsActive()) {
            follower.update()
            Scheduler.execute()

            telemetry.addData("x", follower.pose().x())
            telemetry.addData("y", follower.pose().y())
            telemetry.addData("heading", follower.pose().heading())

            if (follower.currentPath() != null) {
                telemetry.addData("Current path distance remaining", follower.distanceToEndpoint())
                telemetry.addData("Path number", follower.pathIndex())
            }

            telemetry.update()
        }
    }

    fun path1(): Path = Paths.line(start, path1).linear(start, path1)

    fun path2(): Path = Paths.line(path2Start, path2).linear(path2Start, path2)

    fun path3(): Path = Paths.line(path3Start, path3).linear(path3Start, path3)

    fun path4(): Path = Paths.line(path4Start, path4).linear(path4Start, path4)

    fun path5(): Path = Paths.line(path5Start, path5).linear(path5Start, path5)
}
