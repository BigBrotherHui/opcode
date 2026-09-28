//! Windows: prevent spawned child processes from flashing console windows.
//! A GUI app (windows_subsystem="windows") spawning a console program
//! allocates a visible console per child unless CREATE_NO_WINDOW is set.

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Apply CREATE_NO_WINDOW to a std Command (no-op on non-Windows).
pub fn nw_std(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Apply CREATE_NO_WINDOW to a tokio Command (no-op on non-Windows).
pub fn nw_tokio(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.as_std_mut().creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}
