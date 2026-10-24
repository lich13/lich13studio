#[cfg(target_os = "macos")]
use super::decode_launch_event;
use super::{
    launch_show_reason, should_start_silently, startup_source, LaunchAppleEvent,
    RestoredWindowMode, ShowReason, StartupSource, StartupVisibility, LOGIN_STARTUP_ARG,
};

#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2_foundation::NSAppleEventDescriptor;

const OPEN_APPLICATION: u32 = u32::from_be_bytes(*b"oapp");
const LOGIN_ITEM: u32 = u32::from_be_bytes(*b"lgit");

fn login_item_event() -> LaunchAppleEvent {
    LaunchAppleEvent {
        event_id: OPEN_APPLICATION,
        launch_reason: Some(LOGIN_ITEM),
    }
}

#[cfg(target_os = "macos")]
fn native_apple_event(
    event_id: u32,
    parameter: Option<(u32, u32)>,
) -> Retained<NSAppleEventDescriptor> {
    let event = NSAppleEventDescriptor::appleEventWithEventClass_eventID_targetDescriptor_returnID_transactionID(
        u32::from_be_bytes(*b"aevt"),
        event_id,
        None,
        -1,
        0,
    );
    if let Some((keyword, value)) = parameter {
        let descriptor = NSAppleEventDescriptor::descriptorWithEnumCode(value);
        event.setParamDescriptor_forKeyword(&descriptor, keyword);
    }
    event
}

#[test]
fn macos_login_item_event_is_classified_from_launch_provenance() {
    // `launch_reason` is the value read from the Apple event's `prdt` keyword;
    // mutable AppKit hidden state is not part of this decision.
    assert_eq!(
        startup_source(&[], Some(login_item_event())),
        StartupSource::MacOSLoginItem
    );
}

#[cfg(target_os = "macos")]
#[test]
fn native_apple_event_descriptor_decodes_prdt_lgit_and_applies_silent_startup() {
    // Keep these fixture codes literal and independent from production constants.
    let event = native_apple_event(
        u32::from_be_bytes(*b"oapp"),
        Some((u32::from_be_bytes(*b"prdt"), u32::from_be_bytes(*b"lgit"))),
    );
    let decoded = decode_launch_event(&event);

    assert_eq!(
        decoded,
        LaunchAppleEvent {
            event_id: u32::from_be_bytes(*b"oapp"),
            launch_reason: Some(u32::from_be_bytes(*b"lgit")),
        }
    );
    let source = startup_source(&[], Some(decoded));
    assert_eq!(source, StartupSource::MacOSLoginItem);
    assert!(should_start_silently(source, true));
    assert!(!should_start_silently(source, false));

    let mut silent = StartupVisibility::new(source, true);
    // The frontend startup request and delayed fallback both use Automatic.
    assert!(!silent.request_show(ShowReason::Automatic, true));
    assert!(!silent.request_show(ShowReason::Automatic, true));
    assert!(!silent.has_presented());

    let mut visible = StartupVisibility::new(source, false);
    assert!(visible.request_show(ShowReason::Automatic, false));
}

#[cfg(target_os = "macos")]
#[test]
fn native_apple_event_descriptor_rejects_missing_wrong_and_ordinary_fields() {
    let open_application = u32::from_be_bytes(*b"oapp");
    let property_data = u32::from_be_bytes(*b"prdt");
    let login_item = u32::from_be_bytes(*b"lgit");
    let events = [
        (
            "missing parameter",
            native_apple_event(open_application, None),
        ),
        (
            "wrong parameter keyword",
            native_apple_event(
                open_application,
                Some((u32::from_be_bytes(*b"prop"), login_item)),
            ),
        ),
        (
            "wrong parameter value",
            native_apple_event(
                open_application,
                Some((property_data, u32::from_be_bytes(*b"xxxx"))),
            ),
        ),
        (
            "ordinary event",
            native_apple_event(
                u32::from_be_bytes(*b"odoc"),
                Some((property_data, login_item)),
            ),
        ),
    ];

    for (case, event) in events {
        let decoded = decode_launch_event(&event);
        let source = startup_source(&[], Some(decoded));
        assert_eq!(
            source,
            StartupSource::Normal,
            "unexpected source for {case}"
        );
        assert!(
            !should_start_silently(source, true),
            "unexpected silence for {case}"
        );
    }
}

#[test]
fn login_startup_argument_requires_an_exact_token_and_takes_precedence() {
    let login_args = vec![LOGIN_STARTUP_ARG.to_string()];

    assert_eq!(
        startup_source(&login_args, None),
        StartupSource::LoginStartupArg
    );
    assert_eq!(
        startup_source(&login_args, Some(login_item_event())),
        StartupSource::LoginStartupArg
    );

    for arg in [
        "--not-lich13studio-login-startup",
        "--lich13studio-login-startup=true",
        "prefix--lich13studio-login-startup",
        "oapp",
        "prop=lgit",
    ] {
        assert_eq!(
            startup_source(&[arg.to_string()], None),
            StartupSource::Normal,
            "unexpected login classification for {arg:?}"
        );
    }
}

#[test]
fn missing_or_wrong_launch_event_fields_remain_normal_startup() {
    let ordinary_args = vec!["--open-settings".to_string()];
    let events = [
        None,
        Some(LaunchAppleEvent {
            event_id: OPEN_APPLICATION,
            launch_reason: None,
        }),
        Some(LaunchAppleEvent {
            event_id: OPEN_APPLICATION,
            launch_reason: Some(0),
        }),
        Some(LaunchAppleEvent {
            event_id: u32::from_be_bytes(*b"odoc"),
            launch_reason: Some(LOGIN_ITEM),
        }),
    ];

    for event in events {
        assert_eq!(startup_source(&ordinary_args, event), StartupSource::Normal);
    }
}

#[test]
fn login_startup_is_silent_only_when_the_setting_is_enabled() {
    assert!(should_start_silently(StartupSource::LoginStartupArg, true));
    assert!(should_start_silently(StartupSource::MacOSLoginItem, true));
    assert!(!should_start_silently(
        StartupSource::LoginStartupArg,
        false
    ));
    assert!(!should_start_silently(StartupSource::MacOSLoginItem, false));
    assert!(!should_start_silently(StartupSource::Normal, true));

    let mut visible_login = StartupVisibility::new(StartupSource::LoginStartupArg, false);
    assert!(!visible_login.is_silent());
    assert!(visible_login.request_show(ShowReason::Automatic, false));
}

#[test]
fn automatic_show_uses_the_startup_snapshot_and_presents_at_most_once() {
    let mut normal = StartupVisibility::new(StartupSource::Normal, false);
    assert!(!normal.is_silent());
    assert!(normal.request_show(ShowReason::Automatic, false));
    assert!(normal.has_presented());
    // A delayed automatic callback cannot present the same window again.
    assert!(!normal.request_show(ShowReason::Automatic, true));

    let mut silent = StartupVisibility::new(StartupSource::LoginStartupArg, true);
    assert!(silent.is_silent());
    // Even if launch-to-tray changes at runtime, automatic callbacks follow the
    // frozen startup decision.
    assert!(!silent.request_show(ShowReason::Automatic, false));
    assert!(!silent.request_show(ShowReason::Automatic, false));
    assert!(!silent.has_presented());
}

#[test]
fn user_show_wakes_silent_startup_and_blocks_late_automatic_show() {
    let mut visibility = StartupVisibility::new(StartupSource::MacOSLoginItem, true);

    assert!(!visibility.request_show(ShowReason::Automatic, true));
    assert!(visibility.request_show(ShowReason::User, true));
    assert!(visibility.has_presented());
    assert!(!visibility.request_show(ShowReason::Automatic, false));
}

#[test]
fn repeated_login_launches_stay_silent_but_manual_launch_can_show() {
    let login_source = StartupSource::MacOSLoginItem;
    let mut login_visibility = StartupVisibility::new(login_source, true);
    assert!(!login_visibility.request_show(ShowReason::Launch(login_source), true));
    assert!(!login_visibility.request_show(ShowReason::Launch(login_source), true));

    let mut manual_visibility = StartupVisibility::new(login_source, true);
    assert!(manual_visibility.request_show(ShowReason::Launch(StartupSource::Normal), true));
}

#[test]
fn launch_show_reason_preserves_login_and_normal_launches() {
    let login_args = vec![LOGIN_STARTUP_ARG.to_string()];
    assert_eq!(
        launch_show_reason(&login_args, None),
        ShowReason::Launch(StartupSource::LoginStartupArg)
    );
    assert_eq!(
        launch_show_reason(&[], Some(login_item_event())),
        ShowReason::Launch(StartupSource::MacOSLoginItem)
    );

    assert_eq!(
        launch_show_reason(&["https://example.invalid/content".to_string()], None),
        ShowReason::Launch(StartupSource::Normal)
    );
    assert_eq!(
        launch_show_reason(&[], None),
        ShowReason::Launch(StartupSource::Normal)
    );
}

#[test]
fn restored_fullscreen_takes_priority_over_maximized_state() {
    assert_eq!(
        RestoredWindowMode::from_saved(true, true),
        RestoredWindowMode::Fullscreen
    );
    assert_eq!(
        RestoredWindowMode::from_saved(false, true),
        RestoredWindowMode::Maximized
    );
    assert_eq!(
        RestoredWindowMode::from_saved(false, false),
        RestoredWindowMode::Normal
    );
}
