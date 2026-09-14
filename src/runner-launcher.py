"""Trusted launcher inside the namespace. Never invoke a shell or accept commands from a lesson."""
import ctypes
import errno
import os
import resource
import subprocess
import sys

language, executable = sys.argv[1:3]
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
resource.setrlimit(resource.RLIMIT_FSIZE, (4 * 1024**2, 4 * 1024**2))
resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
resource.setrlimit(resource.RLIMIT_CPU, (8, 9))
resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024**2, 1536 * 1024**2))

java_flags = ['-Xms16m', '-Xmx128m', '-Xss512k', '-XX:+UseSerialGC',
              '-XX:ActiveProcessorCount=1', '-XX:CompressedClassSpaceSize=32m',
              '-XX:ReservedCodeCacheSize=32m', '-XX:MaxMetaspaceSize=128m', '-XX:-UsePerfData']
commands = {
    'python': [executable, '-I', '-B', '-u', '/work/main.py'],
    'javascript': [executable, '--jitless', '--no-expose-wasm', '--max-old-space-size=128', '/work/main.js'],
    'java': [executable, *java_flags, '-cp', '/work', 'Main'],
    'c': ['/work/program'],
    'cpp': ['/work/program'],
}
if language == 'java':
    compiler = sys.argv[3]
    compilation = [compiler, *['-J' + flag for flag in java_flags], '-encoding', 'UTF-8', '-d', '/work', '/work/Main.java']
elif language in ('c', 'cpp'):
    compilation = [executable, '/work/main.' + ('c' if language == 'c' else 'cpp'), '-o', '/work/program', '-O0', '-Wall', '-Wextra', '-std=' + ('c17' if language == 'c' else 'c++17')]
else:
    compilation = None
if compilation:
    result = subprocess.run(compilation, stdin=subprocess.DEVNULL, check=False)
    if result.returncode:
        sys.exit(result.returncode if result.returncode > 0 else 1)

# Prevent the exercise from creating child processes; pthreads used by the JVM
# and Node remain possible. clone3 returns ENOSYS so libc uses filtered clone.
# Fail closed when libseccomp is missing, including on non-x86 Linux architectures.
try:
    lib = ctypes.CDLL('libseccomp.so.2', use_errno=True)
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
    lib.seccomp_rule_add_array.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint, ctypes.c_void_p]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    class Comparison(ctypes.Structure):
        _fields_ = [('arg', ctypes.c_uint), ('op', ctypes.c_int), ('mask', ctypes.c_uint64), ('value', ctypes.c_uint64)]
    context = lib.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW
    if not context:
        raise RuntimeError('seccomp_init')
    def deny(name, error=errno.EPERM, comparison=None):
        number = lib.seccomp_syscall_resolve_name(name.encode())
        if number < 0:
            return
        result = lib.seccomp_rule_add_array(context, 0x00050000 | error, number,
                                           1 if comparison is not None else 0,
                                           ctypes.byref(comparison) if comparison is not None else None)
        if result != 0:
            raise RuntimeError('seccomp_rule: ' + name)
    for name in ('fork', 'vfork', 'unshare', 'setns', 'mount', 'umount2', 'pivot_root',
                 'ptrace', 'bpf', 'perf_event_open', 'keyctl', 'add_key', 'request_key'):
        deny(name)
    deny('clone3', errno.ENOSYS)
    deny('clone', comparison=Comparison(0, 7, 0x00010000, 0))  # MASKED_EQ: no CLONE_THREAD
    if lib.seccomp_load(context) != 0:
        raise RuntimeError('seccomp_load')
    lib.seccomp_release(context)
except Exception as error:
    print('Isolamento indisponível: ' + str(error), file=sys.stderr)
    sys.exit(78)

os.execv(commands[language][0], commands[language])
