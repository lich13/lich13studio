//! Launch provenance and window presentation are independent of AppKit's mutable
//! hidden/active state. Keep the decision here shared by every show entrypoint.

pub const LOGIN_STARTUP_ARG: &str = "--lich13studio-login-startup";
const OPEN_APPLICATION: u32 = u32::from_be_bytes(*b"oapp");
const LOGIN_ITEM: u32 = u32::from_be_bytes(*b"lgit");
#[cfg(target_os = "macos")]
const APPLE_EVENT_PROPERTY_DATA: u32 = u32::from_be_bytes(*b"prdt");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupSource {
    Normal,
    LoginStartupArg,
    MacOSLoginItem,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LaunchAppleEvent {
    pub event_id: u32,
    pub launch_reason: Option<u32>,
}

pub fn startup_source(args: &[String], event: Option<LaunchAppleEvent>) -> StartupSource {
    if args.iter().any(|arg| arg == LOGIN_STARTUP_ARG) {
        StartupSource::LoginStartupArg
    } else if matches!(
        event,
        Some(LaunchAppleEvent {
            event_id: OPEN_APPLICATION,
            launch_reason: Some(LOGIN_ITEM)
        })
    ) {
        StartupSource::MacOSLoginItem
    } else {
        StartupSource::Normal
    }
}

pub fn should_start_silently(source: StartupSource, launch_to_tray: bool) -> bool {
    launch_to_tray && source != StartupSource::Normal
}

pub fn has_provider_import(args: &[String]) -> bool {
    args.iter().any(|arg| {
        url::Url::parse(arg)
            .map(|url| url.scheme() == "ccswitch")
            .unwrap_or(false)
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShowReason {
    Automatic,
    Launch(StartupSource),
    User,
}

pub fn launch_show_reason(args: &[String], event: Option<LaunchAppleEvent>) -> ShowReason {
    if has_provider_import(args) {
        ShowReason::User
    } else {
        ShowReason::Launch(startup_source(args, event))
    }
}

#[derive(Debug, Default)]
pub struct StartupVisibility {
    silent: bool,
    presented: bool,
}

impl StartupVisibility {
    pub fn new(source: StartupSource, launch_to_tray: bool) -> Self {
        Self {
            silent: should_start_silently(source, launch_to_tray),
            presented: false,
        }
    }

    pub fn is_silent(&self) -> bool {
        self.silent
    }
    pub fn has_presented(&self) -> bool {
        self.presented
    }

    pub fn request_show(&mut self, reason: ShowReason, launch_to_tray: bool) -> bool {
        match reason {
            ShowReason::Automatic if self.silent || self.presented => return false,
            ShowReason::Launch(source) if should_start_silently(source, launch_to_tray) => {
                return false
            }
            _ => {}
        }
        self.presented = true;
        true
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum RestoredWindowMode {
    #[default]
    Normal,
    Maximized,
    Fullscreen,
}

impl RestoredWindowMode {
    pub fn from_saved(fullscreen: bool, maximized: bool) -> Self {
        if fullscreen {
            Self::Fullscreen
        } else if maximized {
            Self::Maximized
        } else {
            Self::Normal
        }
    }
}

#[cfg(target_os = "macos")]
fn decode_launch_event(event: &objc2_foundation::NSAppleEventDescriptor) -> LaunchAppleEvent {
    LaunchAppleEvent {
        event_id: event.eventID(),
        // keyAEPropData carries the launch reason; keyAEPropID ('prop') does not.
        launch_reason: event
            .paramDescriptorForKeyword(APPLE_EVENT_PROPERTY_DATA)
            .map(|descriptor| descriptor.enumCodeValue()),
    }
}

#[cfg(target_os = "macos")]
pub fn current_launch_event() -> Option<LaunchAppleEvent> {
    use objc2::MainThreadMarker;
    use objc2_foundation::NSAppleEventManager;

    // AppKit may already have activated the app by the time Tauri is ready.
    // The current launch Apple event still carries the original login reason.
    let _main_thread = MainThreadMarker::new()?;
    let event = NSAppleEventManager::sharedAppleEventManager().currentAppleEvent()?;
    Some(decode_launch_event(&event))
}

#[cfg(not(target_os = "macos"))]
pub fn current_launch_event() -> Option<LaunchAppleEvent> {
    None
}

#[cfg(test)]
mod tests;
