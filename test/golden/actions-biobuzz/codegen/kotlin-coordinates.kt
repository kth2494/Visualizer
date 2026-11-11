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

    fun path1(): Path = Paths.line(start, path1).linear(start, path1)

    fun path2(): Path = Paths.line(path2Start, path2).linear(path2Start, path2)

    fun path3(): Path = Paths.line(path3Start, path3).linear(path3Start, path3)

    fun path4(): Path = Paths.line(path4Start, path4).linear(path4Start, path4)

    fun path5(): Path = Paths.line(path5Start, path5).linear(path5Start, path5)