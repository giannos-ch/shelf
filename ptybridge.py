#!/usr/bin/env python3
"""Fallback PTY bridge used when node-pty is not installed (macOS/Linux only).

Usage: ptybridge.py COLS ROWS PROGRAM [ARGS...]
  stdin  -> written to the PTY
  stdout <- everything the program prints
  fd 3   <- control lines: "COLS ROWS\n" to resize
Exits with the program's exit code.
"""
import errno, fcntl, os, pty, select, signal, struct, sys, termios


def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main():
    cols, rows, argv = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]
    pid, fd = pty.fork()
    if pid == 0:
        # Python ignores SIGPIPE and exec'd programs would inherit that
        # (`ls | head` would then print "Broken pipe"). Restore the default.
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
        try:
            os.execvp(argv[0], argv)
        except Exception as e:  # noqa
            sys.stderr.write(f"exec failed: {e}\n")
            os._exit(127)
    set_size(fd, cols, rows)

    def forward(sig, _frame):
        try:
            os.killpg(pid, signal.SIGHUP if sig == signal.SIGTERM else sig)
        except ProcessLookupError:
            pass
    for s in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(s, forward)

    ctrl_open, stdin_open, ctrl_buf = True, True, b""
    while True:
        rlist = [fd] + ([0] if stdin_open else []) + ([3] if ctrl_open else [])
        try:
            ready, _, _ = select.select(rlist, [], [])
        except InterruptedError:
            continue
        if fd in ready:
            try:
                data = os.read(fd, 65536)
            except OSError as e:
                if e.errno in (errno.EIO, errno.EBADF):
                    break
                raise
            if not data:
                break
            os.write(1, data)
        if 0 in ready:
            data = os.read(0, 65536)
            if data:
                os.write(fd, data)
            else:
                stdin_open = False
        if 3 in ready:
            data = os.read(3, 4096)
            if not data:
                ctrl_open = False
            ctrl_buf += data
            while b"\n" in ctrl_buf:
                line, ctrl_buf = ctrl_buf.split(b"\n", 1)
                try:
                    c, r = map(int, line.split())
                    set_size(fd, c, r)
                except Exception:
                    pass
    _, status = os.waitpid(pid, 0)
    if os.WIFSIGNALED(status):
        sys.exit(128 + os.WTERMSIG(status))
    sys.exit(os.WEXITSTATUS(status))


if __name__ == "__main__":
    main()
