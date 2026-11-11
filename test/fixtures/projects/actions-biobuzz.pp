{
  "startPoint": {
    "x": 86.27,
    "y": 8,
    "headingDeg": 90,
    "locked": false
  },
  "lines": [
    {
      "kind": "atomic",
      "id": "line-1",
      "name": "Path 1",
      "endPoint": {
        "x": 85.82,
        "y": 13.22,
        "name": "shootPose"
      },
      "controlPoints": [],
      "heading": {
        "type": "linear",
        "startDeg": 90,
        "endDeg": 70
      },
      "color": "#ffc516",
      "locked": false,
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": "",
      "actionsAfter": [
        "shoot"
      ]
    },
    {
      "kind": "atomic",
      "id": "line-2",
      "name": "Path 2",
      "endPoint": {
        "x": 97.34,
        "y": 34.4,
        "name": "ilgongsijak"
      },
      "controlPoints": [],
      "heading": {
        "type": "linear",
        "startDeg": 70,
        "endDeg": 0
      },
      "color": "#ffc516",
      "locked": false,
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": ""
    },
    {
      "kind": "atomic",
      "id": "line-3",
      "name": "Path 3",
      "endPoint": {
        "x": 124,
        "y": 34.4,
        "name": "ilgongmeok"
      },
      "controlPoints": [],
      "heading": {
        "type": "linear",
        "startDeg": 0,
        "endDeg": 0
      },
      "color": "#ffc516",
      "locked": false,
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": "",
      "actionsDuring": [
        "intake"
      ]
    },
    {
      "kind": "atomic",
      "id": "line-4",
      "name": "Path 4",
      "endPoint": {
        "x": 85.82,
        "y": 13.22,
        "name": "shootPose2"
      },
      "controlPoints": [],
      "heading": {
        "type": "linear",
        "startDeg": 0,
        "endDeg": 70
      },
      "color": "#ffc516",
      "locked": false,
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": "",
      "actionsAfter": [
        "shoot"
      ]
    },
    {
      "kind": "atomic",
      "id": "line-5",
      "name": "Path 5",
      "endPoint": {
        "x": 90.97,
        "y": 19.1,
        "name": "endPose"
      },
      "controlPoints": [],
      "heading": {
        "type": "linear",
        "startDeg": 70,
        "endDeg": 90
      },
      "color": "#ffc516",
      "locked": false,
      "waitBeforeMs": 0,
      "waitAfterMs": 0,
      "waitBeforeName": "",
      "waitAfterName": ""
    }
  ],
  "shapes": [],
  "sequence": [
    {
      "kind": "path",
      "lineId": "line-1"
    },
    {
      "kind": "path",
      "lineId": "line-2"
    },
    {
      "kind": "path",
      "lineId": "line-3"
    },
    {
      "kind": "path",
      "lineId": "line-4"
    },
    {
      "kind": "path",
      "lineId": "line-5"
    }
  ],
  "fieldPoints": [],
  "actions": [
    {
      "id": "shoot",
      "name": "발사",
      "kind": "timed",
      "durationMs": 4000,
      "steps": [
        {
          "atMs": 0,
          "code": "launch1.setVelocity(1600);\nlaunch2.setVelocity(-1600);"
        },
        {
          "atMs": 1500,
          "code": "intake.setPower(1);\nballmove.setPower(0.78);"
        },
        {
          "atMs": 4000,
          "code": "launch1.setVelocity(0);\nlaunch2.setVelocity(0);\nintake.setPower(0);\nballmove.setPower(0);"
        }
      ]
    },
    {
      "id": "intake",
      "name": "흡입",
      "kind": "during",
      "start": "intake.setPower(1);\nballmove.setPower(0.1);",
      "stop": "intake.setPower(0);\nballmove.setPower(0);"
    }
  ],
  "hardware": {
    "imports": "import com.qualcomm.robotcore.hardware.DcMotorEx;\nimport org.firstinspires.ftc.teamcode.pedro.Constants;",
    "fields": "private DcMotorEx launch1, launch2, intake, ballmove;",
    "init": "launch1 = hardwareMap.get(DcMotorEx.class, \"launch\");\nlaunch2 = hardwareMap.get(DcMotorEx.class, \"launch2\");\nintake = hardwareMap.get(DcMotorEx.class, \"intake\");\nballmove = hardwareMap.get(DcMotorEx.class, \"ballmove\");"
  },
  "version": "2.0.0",
  "timestamp": "2026-11-12T00:00:00.000Z"
}
