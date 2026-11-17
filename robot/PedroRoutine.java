package org.firstinspires.ftc.teamcode;

import com.pedropathing.api.Paths;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Command;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import com.pedropathing.paths.interpolator.Interpolator;
import com.pedropathing.paths.interpolator.PiecewiseInterpolator;

import static com.pedropathing.ivy.commands.Commands.waitMs;
import static com.pedropathing.ivy.groups.Groups.sequential;
import static com.pedropathing.ivy.pedro.PedroCommands.follow;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;

/**
 * A routine sent from the Pedro Pathing Visualizer ("Send to robot").
 * Every path is rebuilt with the same Pedro calls the sequential Java export
 * writes, so a sent routine drives exactly like the exported OpMode.
 */
public class PedroRoutine {
    public static final String FORMAT = "pedro-routine";
    public static final int VERSION = 1;

    public final String name;
    public final Pose start;
    public final int pathCount;
    /** Why this routine must not run; empty when it is ready. */
    public final List<String> problems = new ArrayList<>();
    /** Built paths by name, as the sequential export's path methods would return them. */
    public final Map<String, Path> paths = new HashMap<>();
    private final List<Command> steps = new ArrayList<>();

    private static final PoseFactory POSES = PoseFactory.degrees();

    /** Parses and builds everything now, so mistakes show during Init, not mid-auto. */
    public PedroRoutine(String json, Follower follower, String actionsHash,
                        BiFunction<String, String, Command> actions) {
        String name = "?";
        Pose start = null;
        int pathCount = 0;
        try {
            JSONObject root = new JSONObject(json);
            name = root.optString("name", "?");
            if (!FORMAT.equals(root.optString("format")) || root.optInt("version") != VERSION) {
                throw new JSONException("not a version " + VERSION + " routine; update the robot code or the Visualizer");
            }
            if (!actionsHash.equals(root.optString("actionsHash"))) {
                problems.add("Robot actions changed in the Visualizer. Save RobotActions.java again and reinstall the app.");
            }
            start = pose(root.getJSONArray("start"));

            JSONObject pathsJson = root.getJSONObject("paths");
            for (java.util.Iterator<String> it = pathsJson.keys(); it.hasNext(); ) {
                String key = it.next();
                paths.put(key, path(pathsJson.getJSONObject(key)));
            }

            JSONArray stepsJson = root.getJSONArray("steps");
            for (int i = 0; i < stepsJson.length(); i++) {
                JSONObject step = stepsJson.getJSONObject(i);
                if (step.has("path")) {
                    Path p = paths.get(step.getString("path"));
                    if (p == null) throw new JSONException("step " + (i + 1) + " names a missing path");
                    steps.add(follow(follower, p));
                    pathCount++;
                } else if (step.has("wait")) {
                    steps.add(waitMs(step.getDouble("wait")));
                } else if (step.has("action")) {
                    String id = step.getString("action"), phase = step.getString("phase");
                    Command command = actions.apply(id, phase);
                    if (command == null) {
                        problems.add("RobotActions has no \"" + id + "/" + phase + "\". Save RobotActions.java again and reinstall.");
                    } else {
                        steps.add(command);
                    }
                } else {
                    throw new JSONException("step " + (i + 1) + " is not a path, wait or action");
                }
            }
        } catch (Exception e) {
            problems.add("Cannot read this routine: " + e);
        }
        this.name = name;
        this.start = start;
        this.pathCount = pathCount;
    }

    public Command command() {
        return sequential(steps.toArray(new Command[0]));
    }

    private static Pose pose(JSONArray a) throws JSONException {
        return POSES.of(a.getDouble(0), a.getDouble(1), a.getDouble(2));
    }

    private static Pose[] poses(JSONArray a) throws JSONException {
        Pose[] out = new Pose[a.length()];
        for (int i = 0; i < out.length; i++) out[i] = pose(a.getJSONArray(i));
        return out;
    }

    private static Path path(JSONObject json) throws JSONException {
        String type = json.getString("type");
        Path base;
        switch (type) {
            case "group": {
                JSONArray children = json.getJSONArray("children");
                Path[] parts = new Path[children.length()];
                for (int i = 0; i < parts.length; i++) parts[i] = path(children.getJSONObject(i));
                base = Paths.path(parts);
                break;
            }
            case "line": {
                Pose[] p = poses(json.getJSONArray("poses"));
                base = Paths.line(p[0], p[1]);
                break;
            }
            case "curve":
                base = Paths.curve(poses(json.getJSONArray("poses")));
                break;
            case "through":
                base = Paths.through(poses(json.getJSONArray("poses")));
                break;
            default:
                throw new JSONException("unknown path type " + type);
        }
        JSONObject heading = json.optJSONObject("heading");
        return heading == null ? base : withHeading(base, heading);
    }

    private static Path withHeading(Path path, JSONObject h) throws JSONException {
        switch (h.getString("type")) {
            case "constant":
                return path.constant(pose(h.getJSONArray("pose")));
            case "linear":
                return path.linear(pose(h.getJSONArray("start")), pose(h.getJSONArray("end")));
            case "tangent":
                return path.tangent();
            case "reverseTangent":
                return path.reverseTangent();
            case "facingPoint":
                return path.facingPoint(pose(h.getJSONArray("pose")));
            case "piecewise": {
                PiecewiseInterpolator chain = Interpolator.piecewise();
                JSONArray nodes = h.getJSONArray("nodes");
                for (int i = 0; i < nodes.length(); i++) {
                    JSONObject node = nodes.getJSONObject(i);
                    Interpolator interpolator = interpolator(node.getJSONObject("interpolator"));
                    if (node.optBoolean("reversed")) interpolator = interpolator.reverse();
                    chain = chain.until(node.getDouble("until"), interpolator);
                }
                return path.heading(chain);
            }
            default:
                throw new JSONException("unknown heading type " + h.getString("type"));
        }
    }

    private static Interpolator interpolator(JSONObject h) throws JSONException {
        switch (h.getString("type")) {
            case "constant":
                return Interpolator.constant(pose(h.getJSONArray("pose")));
            case "linear":
                return Interpolator.linear(pose(h.getJSONArray("start")), pose(h.getJSONArray("end")));
            case "tangent":
                return Interpolator.tangent;
            case "facingPoint":
                return Interpolator.facingPoint(pose(h.getJSONArray("pose")));
            default:
                throw new JSONException("unknown interpolator type " + h.getString("type"));
        }
    }
}
