"""A program on a Windows pseudoconsole (ConPTY), for signing bw in from `roster serve` on native Windows (ticket 63).

Linux and macOS run `bw login` on a PTY (providers/bw_login.py); this is Windows' counterpart, with ctypes and no
dependency: CreatePseudoConsole (Windows 10 1809 and later) gives the program a console whose input roster writes
and whose screen roster reads, as VT text. The program and everything it starts are in a job object that kills them
all when roster lets go of it, so a `bw.cmd` and its node never outlive the sign-in.

Nothing secret is on the command line: the caller passes those in the environment block, which only the program
itself can read.
"""

import codecs
import ctypes
import subprocess
import threading
from ctypes import wintypes

from .common import program_argv

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

HPCON = wintypes.HANDLE
PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016
EXTENDED_STARTUPINFO_PRESENT = 0x00080000
CREATE_UNICODE_ENVIRONMENT = 0x00000400
CREATE_SUSPENDED = 0x00000004
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9
WAIT_OBJECT_0 = 0
STARTF_USESTDHANDLES = 0x00000100


class COORD(ctypes.Structure):
    _fields_ = [("X", wintypes.SHORT), ("Y", wintypes.SHORT)]


class STARTUPINFOW(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("lpReserved", wintypes.LPWSTR), ("lpDesktop", wintypes.LPWSTR),
                ("lpTitle", wintypes.LPWSTR), ("dwX", wintypes.DWORD), ("dwY", wintypes.DWORD),
                ("dwXSize", wintypes.DWORD), ("dwYSize", wintypes.DWORD), ("dwXCountChars", wintypes.DWORD),
                ("dwYCountChars", wintypes.DWORD), ("dwFillAttribute", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
                ("wShowWindow", wintypes.WORD), ("cbReserved2", wintypes.WORD), ("lpReserved2", ctypes.c_void_p),
                ("hStdInput", wintypes.HANDLE), ("hStdOutput", wintypes.HANDLE), ("hStdError", wintypes.HANDLE)]


class STARTUPINFOEXW(ctypes.Structure):
    _fields_ = [("StartupInfo", STARTUPINFOW), ("lpAttributeList", ctypes.c_void_p)]


class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [("hProcess", wintypes.HANDLE), ("hThread", wintypes.HANDLE), ("dwProcessId", wintypes.DWORD),
                ("dwThreadId", wintypes.DWORD)]


class IO_COUNTERS(ctypes.Structure):
    _fields_ = [(n, ctypes.c_ulonglong) for n in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                                                  "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]


class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
                ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]


class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION), ("IoInfo", IO_COUNTERS),
                ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]


kernel32.CreateJobObjectW.restype = wintypes.HANDLE
kernel32.CreatePseudoConsole.restype = ctypes.c_long
kernel32.CreatePseudoConsole.argtypes = [COORD, wintypes.HANDLE, wintypes.HANDLE, wintypes.DWORD,
                                         ctypes.POINTER(HPCON)]
kernel32.ClosePseudoConsole.argtypes = [HPCON]
kernel32.UpdateProcThreadAttribute.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.c_size_t, ctypes.c_void_p,
                                               ctypes.c_size_t, ctypes.c_void_p, ctypes.c_void_p]
kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
kernel32.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]


def _check(ok):
    if not ok:
        raise ctypes.WinError(ctypes.get_last_error())


def _env_block(env):
    """ENV as CreateProcessW's Unicode environment block: NAME=VALUE, each ended by a NUL, and a NUL after the last."""
    text = "".join(f"{k}={v}\0" for k, v in sorted(env.items(), key=lambda kv: kv[0].upper())) + "\0"
    return ctypes.create_unicode_buffer(text, len(text))


class ConPty:
    """ARGS running on a pseudoconsole of COLS x ROWS with environment ENV. read() hands over the console's output
    (VT text) as it comes, write() types, exitcode() is None while it runs, close() ends it and everything it started.
    A program that isn't on PATH raises FileNotFoundError."""

    def __init__(self, args, env, cols=240, rows=40):
        argv = program_argv(args)
        if not argv or "\\" not in argv[0] and "/" not in argv[0]:
            raise FileNotFoundError(args[0])                   # program_argv found it on PATH, or it isn't there
        self._chunks, self._lock, self._eof = [], threading.Lock(), threading.Event()
        self._decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self._hpc = self._job = self._attrs = None
        self._pi = PROCESS_INFORMATION()
        in_read, self._in = wintypes.HANDLE(), wintypes.HANDLE()
        self._out, out_write = wintypes.HANDLE(), wintypes.HANDLE()
        try:
            _check(kernel32.CreatePipe(ctypes.byref(in_read), ctypes.byref(self._in), None, 0))
            _check(kernel32.CreatePipe(ctypes.byref(self._out), ctypes.byref(out_write), None, 0))
            hpc = HPCON()
            hr = kernel32.CreatePseudoConsole(COORD(cols, rows), in_read, out_write, 0, ctypes.byref(hpc))
            if hr != 0:
                raise OSError(f"CreatePseudoConsole failed (0x{hr & 0xFFFFFFFF:08x})")
            self._hpc = hpc
        finally:                    # the pseudoconsole holds its own ends of the pipes now
            for h in (in_read, out_write):
                if h.value:
                    kernel32.CloseHandle(h)
        self._reader = threading.Thread(target=self._pump, daemon=True)
        self._reader.start()
        try:
            self._spawn(subprocess.list2cmdline(argv), env)
        except BaseException:
            self.close()
            raise

    def _spawn(self, cmdline, env):
        size = ctypes.c_size_t()
        kernel32.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(size))
        self._attrs = ctypes.create_string_buffer(size.value)
        _check(kernel32.InitializeProcThreadAttributeList(self._attrs, 1, 0, ctypes.byref(size)))
        _check(kernel32.UpdateProcThreadAttribute(self._attrs, 0, ctypes.c_size_t(PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE),
                                                  self._hpc, ctypes.sizeof(HPCON), None, None))
        si = STARTUPINFOEXW()
        si.StartupInfo.cb = ctypes.sizeof(STARTUPINFOEXW)
        si.lpAttributeList = ctypes.cast(self._attrs, ctypes.c_void_p)
        # No standard handles of ours: without this, a child of a process whose own are redirected (serve's are
        # pipes) writes to those instead of the pseudoconsole. Left empty, they're the pseudoconsole's.
        si.StartupInfo.dwFlags = STARTF_USESTDHANDLES
        self._job = wintypes.HANDLE(kernel32.CreateJobObjectW(None, None))
        _check(self._job.value)
        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        _check(kernel32.SetInformationJobObject(self._job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                                                ctypes.byref(info), ctypes.sizeof(info)))
        line = ctypes.create_unicode_buffer(cmdline)
        if not kernel32.CreateProcessW(None, line, None, None, False,
                                       EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED,
                                       _env_block(env), None, ctypes.byref(si), ctypes.byref(self._pi)):
            err = ctypes.get_last_error()
            if err in (2, 3):                                   # ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND
                raise FileNotFoundError(cmdline)
            raise ctypes.WinError(err)
        _check(kernel32.AssignProcessToJobObject(self._job, self._pi.hProcess))
        kernel32.ResumeThread(self._pi.hThread)

    def _pump(self):
        """The reader thread: everything the pseudoconsole draws, until it closes (a pseudoconsole whose output isn't
        read stalls its program)."""
        buf = ctypes.create_string_buffer(65536)
        n = wintypes.DWORD()
        while kernel32.ReadFile(self._out, buf, len(buf), ctypes.byref(n), None) and n.value:
            data = buf.raw[:n.value]
            if b"\x1b[6n" in data:              # a cursor-position request: answer it, or the program may wait for it
                self.write("\x1b[1;1R")
            with self._lock:
                self._chunks.append(data)
        self._eof.set()

    def read(self, timeout):
        """What the console drew since the last read (waiting up to TIMEOUT s for something), or "" (None at the end)."""
        if not self._chunks and not self._eof.is_set():
            self._wait_some(timeout)
        with self._lock:
            data, self._chunks = b"".join(self._chunks), []
        if not data and self._eof.is_set():
            return None
        return self._decoder.decode(data)

    def _wait_some(self, timeout):
        step = min(timeout, 0.02)
        waited = 0.0
        while waited < timeout and not self._chunks and not self._eof.is_set():
            self._eof.wait(step)
            waited += step

    def write(self, text):
        data = text.encode()
        n = wintypes.DWORD()
        if self._in.value:
            kernel32.WriteFile(self._in, data, len(data), ctypes.byref(n), None)

    def exitcode(self):
        if not self._pi.hProcess or kernel32.WaitForSingleObject(self._pi.hProcess, 0) != WAIT_OBJECT_0:
            return None
        code = wintypes.DWORD()
        kernel32.GetExitCodeProcess(self._pi.hProcess, ctypes.byref(code))
        return code.value

    def finish(self, timeout=3):
        """After the program exited: close the pseudoconsole, which draws what's left and ends the output."""
        if self._hpc:
            kernel32.ClosePseudoConsole(self._hpc)
            self._hpc = None
        self._eof.wait(timeout)

    def close(self):
        """End the program and everything it started, and let go of the console."""
        if self._job is not None:
            kernel32.TerminateJobObject(self._job, 1)
        self.finish(timeout=3)
        for name in ("_in", "_out"):
            h = getattr(self, name)
            if h.value:
                kernel32.CloseHandle(h)
                setattr(self, name, wintypes.HANDLE())
        for h in (self._pi.hProcess, self._pi.hThread):
            if h:
                kernel32.CloseHandle(h)
        self._pi = PROCESS_INFORMATION()
        if self._job is not None:
            kernel32.CloseHandle(self._job)
            self._job = None
        if self._attrs is not None:
            kernel32.DeleteProcThreadAttributeList(self._attrs)
            self._attrs = None
