    private final PoseFactory poseFactory = PoseFactory.degrees();

    private final Pose start = poseFactory.of(86.27, 8, 90);
    private final Pose path1 = poseFactory.of(85.82, 13.22, 70);
    private final Pose path2Start = poseFactory.of(85.82, 13.22, 70);
    private final Pose path2 = poseFactory.of(97.34, 34.4, 0);
    private final Pose path3Start = poseFactory.of(97.34, 34.4, 0);
    private final Pose path3 = poseFactory.of(124, 34.4, 0);
    private final Pose path4Start = poseFactory.of(124, 34.4, 0);
    private final Pose path4 = poseFactory.of(85.82, 13.22, 70);
    private final Pose path5Start = poseFactory.of(85.82, 13.22, 70);
    private final Pose path5 = poseFactory.of(90.97, 19.1, 90);

    public Path path1() {
        return Paths.line(start, path1).linear(start, path1);
    }

    public Path path2() {
        return Paths.line(path2Start, path2).linear(path2Start, path2);
    }

    public Path path3() {
        return Paths.line(path3Start, path3).linear(path3Start, path3);
    }

    public Path path4() {
        return Paths.line(path4Start, path4).linear(path4Start, path4);
    }

    public Path path5() {
        return Paths.line(path5Start, path5).linear(path5Start, path5);
    }