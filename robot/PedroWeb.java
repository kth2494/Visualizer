package org.firstinspires.ftc.teamcode;

import android.content.Context;

import com.qualcomm.robotcore.util.WebHandlerManager;

import org.firstinspires.ftc.ftccommon.external.WebHandlerRegistrar;
import org.firstinspires.ftc.robotcore.internal.system.AppUtil;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

/**
 * Receives routines from the Visualizer's "Send to robot" on the Robot
 * Controller's own web server (port 8080) and keeps them in
 * /sdcard/FIRST/pedro/routines, so they survive restarts.
 *
 *   POST /pedro/routine    save one routine (JSON body, or a form upload)
 *   GET  /pedro/routines   list saved routines
 *   GET  /pedro            page with the list and an upload form
 */
public final class PedroWeb {
    public static final File DIR = new File(AppUtil.FIRST_FOLDER, "pedro/routines");
    private static final int MAX_BYTES = 512 * 1024;

    private PedroWeb() {}

    @WebHandlerRegistrar
    public static void attach(Context context, WebHandlerManager manager) {
        manager.register("/pedro", session -> html(page(null)));
        manager.register("/pedro/routines", session -> cors(json(list().toString())));
        manager.register("/pedro/routine", session -> {
            if (session.getMethod() == NanoHTTPD.Method.OPTIONS) {
                return cors(NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.OK, "text/plain", ""));
            }
            if (session.getMethod() != NanoHTTPD.Method.POST) {
                return cors(json(error("POST a routine here")));
            }
            Map<String, String> body = new HashMap<>();
            String text;
            try {
                session.parseBody(body);
                // A form upload leaves the file on disk; a fetch leaves the text in postData.
                text = body.containsKey("file") ? readFile(new File(body.get("file"))) : body.get("postData");
            } catch (IOException | NanoHTTPD.ResponseException e) {
                text = null;
            }
            String result = save(text);
            return body.containsKey("file") ? html(page(result)) : cors(json(result));
        });
    }

    /** Every saved routine, newest first. */
    public static File[] files() {
        File[] files = DIR.listFiles((dir, name) -> name.endsWith(".json"));
        if (files == null) return new File[0];
        Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        return files;
    }

    public static String read(File file) throws IOException {
        return readFile(file);
    }

    static String save(String text) {
        try {
            if (text == null || text.isEmpty()) return error("The routine was empty");
            if (text.length() > MAX_BYTES) return error("The routine is too large");
            JSONObject routine = new JSONObject(text);
            if (!PedroRoutine.FORMAT.equals(routine.optString("format"))) {
                return error("This is not a Pedro routine file");
            }
            String name = routine.optString("name", "auto");
            String safe = name.replaceAll("[^0-9A-Za-z가-힣_-]", "_");
            if (safe.isEmpty()) safe = "auto";
            if (!DIR.isDirectory() && !DIR.mkdirs()) return error("Cannot create " + DIR);

            File target = new File(DIR, safe + ".json");
            File temp = new File(DIR, safe + ".json.tmp");
            try (OutputStream out = new FileOutputStream(temp)) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            // Keep the previous version, then swap the new one in whole.
            if (target.exists()) {
                File prev = new File(DIR, safe + ".json.prev");
                if (prev.exists()) prev.delete();
                target.renameTo(prev);
            }
            if (!temp.renameTo(target)) return error("Cannot save " + target);

            JSONObject ok = new JSONObject();
            ok.put("ok", true);
            ok.put("name", name);
            ok.put("steps", routine.optJSONArray("steps") == null ? 0 : routine.getJSONArray("steps").length());
            return ok.toString();
        } catch (Exception e) {
            return error("Cannot save: " + e.getMessage());
        }
    }

    private static JSONArray list() {
        JSONArray out = new JSONArray();
        for (File file : files()) {
            try {
                JSONObject entry = new JSONObject();
                entry.put("name", new JSONObject(readFile(file)).optString("name", file.getName()));
                entry.put("savedAt", file.lastModified());
                out.put(entry);
            } catch (Exception ignored) {
                // An unreadable file shows up as a problem in PedroRoutineRun instead.
            }
        }
        return out;
    }

    private static String error(String message) {
        try {
            return new JSONObject().put("ok", false).put("error", message).toString();
        } catch (Exception e) {
            return "{\"ok\":false}";
        }
    }

    private static String readFile(File file) throws IOException {
        try (InputStream in = new FileInputStream(file)) {
            byte[] bytes = new byte[(int) Math.min(file.length(), MAX_BYTES + 1)];
            int n = 0, r;
            while (n < bytes.length && (r = in.read(bytes, n, bytes.length - n)) > 0) n += r;
            return new String(bytes, 0, n, StandardCharsets.UTF_8);
        }
    }

    private static String page(String result) {
        StringBuilder html = new StringBuilder(
                "<!doctype html><html><head><meta charset=\"utf-8\">"
                        + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
                        + "<title>Pedro routines</title></head><body style=\"font-family:sans-serif;max-width:640px;margin:24px auto;padding:0 16px\">"
                        + "<h1>Pedro routines</h1>");
        if (result != null) html.append("<p><b>").append(escape(result)).append("</b></p>");
        html.append("<ul>");
        for (File file : files()) {
            html.append("<li>").append(escape(file.getName())).append(" <small>")
                    .append(new java.util.Date(file.lastModified())).append("</small></li>");
        }
        html.append("</ul><form method=\"post\" action=\"/pedro/routine\" enctype=\"multipart/form-data\">"
                + "<p>Routine file from the Visualizer: <input type=\"file\" name=\"file\" accept=\".json\"> "
                + "<button type=\"submit\">Upload</button></p></form>"
                + "<p><small>Run it from the Driver Station: Pedro Routine (sent).</small></p></body></html>");
        return html.toString();
    }

    private static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private static NanoHTTPD.Response html(String body) {
        return NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.OK, "text/html; charset=utf-8", body);
    }

    private static NanoHTTPD.Response json(String body) {
        return NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.OK, "application/json; charset=utf-8", body);
    }

    /** The Visualizer runs on another origin; Chrome also asks before reaching a local address. */
    private static NanoHTTPD.Response cors(NanoHTTPD.Response response) {
        response.addHeader("Access-Control-Allow-Origin", "*");
        response.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.addHeader("Access-Control-Allow-Headers", "Content-Type");
        response.addHeader("Access-Control-Allow-Private-Network", "true");
        return response;
    }
}
