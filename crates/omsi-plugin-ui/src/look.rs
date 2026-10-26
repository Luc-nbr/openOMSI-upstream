//! The look of the plugins' panels and notifications: the card under them and the accent - openOMSI's,
//! or the interface theme's (`omsi_ui::theme`) - and the menus' own solid greys.

use omsi_ui::Color;

/// The card under a notification or a panel: openOMSI's near black, or the interface
/// theme's surface (`omsi_ui::theme`).
pub(crate) fn card() -> Color {
    let p = omsi_ui::theme::th();
    if p == omsi_ui::theme::Palette::OPENOMSI {
        Color::rgba(14, 16, 20, 225.0 / 255.0)
    } else {
        p.surface.alpha(225.0 / 255.0)
    }
}
pub(crate) const INK: Color = Color::rgba(236, 236, 236, 1.0);
pub(crate) const DARK_INK: Color = Color::rgba(18, 14, 8, 1.0);
/// The accent: openOMSI's amber, or the interface theme's.
pub(crate) fn accent() -> Color {
    omsi_ui::theme::th().accent
}
// (solid greys, the menus' own: the pipeline blends in linear light, where a tenth of white
// over the dark card came out a light grey)
pub(crate) const TRACK: Color = Color::rgba(62, 62, 62, 1.0);
pub(crate) const DIVIDER: Color = Color::rgba(52, 52, 52, 1.0);
pub(crate) const BUTTON: Color = Color::rgba(44, 44, 44, 1.0);
pub(crate) const TILE: Color = Color::rgba(46, 48, 54, 0.6);
pub(crate) const SHADOW: Color = Color::rgba(0, 0, 0, 0.35);
