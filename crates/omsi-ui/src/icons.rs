//! Built-in Material Symbols and custom SVG icons from `assets/icons`.

include!(concat!(env!("OUT_DIR"), "/icons.rs"));

/// The SVG source of an icon by name (`directions_bus`, `stop_request`).
pub fn svg(name: &str) -> Option<&'static str> {
    ICONS.iter().find(|(n, _)| *n == name).map(|(_, s)| *s)
}

/// Every icon name there is.
pub fn names() -> impl Iterator<Item = &'static str> {
    ICONS.iter().map(|(n, _)| *n)
}

/// An icon as an anti-aliased alpha mask of `size` x `size` pixels, with the SVG's margins.
pub fn rasterize(name: &str, size: u32) -> Option<Vec<u8>> {
    let src = svg(name)?;
    let opt = resvg::usvg::Options::default();
    let tree = resvg::usvg::Tree::from_str(src, &opt).ok()?;
    let mut pix = resvg::tiny_skia::Pixmap::new(size, size)?;
    let s = tree.size();
    let k = size as f32 / s.width().max(s.height());
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(k, k), &mut pix.as_mut());
    Some(pix.pixels().iter().map(|p| p.alpha()).collect())
}

/// Any SVG (a logo) in its own colours, fitted into `w` x `h` pixels and centred: straight
/// (not premultiplied) RGBA, as the interface's textures are.
pub fn rasterize_rgba(src: &str, w: u32, h: u32) -> Option<Vec<u8>> {
    let opt = resvg::usvg::Options::default();
    let tree = resvg::usvg::Tree::from_str(src, &opt).ok()?;
    let mut pix = resvg::tiny_skia::Pixmap::new(w, h)?;
    let s = tree.size();
    let k = (w as f32 / s.width()).min(h as f32 / s.height());
    let (dx, dy) = ((w as f32 - s.width() * k) * 0.5, (h as f32 - s.height() * k) * 0.5);
    resvg::render(&tree, resvg::tiny_skia::Transform::from_row(k, 0.0, 0.0, k, dx, dy), &mut pix.as_mut());
    Some(pix.pixels().iter().flat_map(|p| {
        let c = p.demultiply();
        [c.red(), c.green(), c.blue(), c.alpha()]
    }).collect())
}

/// The size an SVG is drawn at (its width and height in its own units); None when it cannot
/// be read.
pub fn svg_size(src: &str) -> Option<(f32, f32)> {
    let tree = resvg::usvg::Tree::from_str(src, &resvg::usvg::Options::default()).ok()?;
    let s = tree.size();
    Some((s.width(), s.height()))
}

/// The length of the path `id` of an SVG (in its own units), as far as its stroke goes:
/// what a theme's loading logo is drawn along (`progress_svg`). None when there is no such path.
pub fn path_length(src: &str, id: &str) -> Option<f32> {
    use resvg::tiny_skia::PathSegment;
    let tree = resvg::usvg::Tree::from_str(src, &resvg::usvg::Options::default()).ok()?;
    let resvg::usvg::Node::Path(path) = tree.node_by_id(id)? else { return None };
    let (mut len, mut at, mut start) = (0.0f32, (0.0f32, 0.0f32), (0.0f32, 0.0f32));
    let dist = |a: (f32, f32), b: (f32, f32)| ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
    // (a curve in 32 straight pieces: a tenth of a per cent off for the arcs of a logo)
    let mut curve = |at: &mut (f32, f32), f: &dyn Fn(f32) -> (f32, f32)| {
        for k in 1..=32 {
            let p = f(k as f32 / 32.0);
            len += dist(*at, p);
            *at = p;
        }
    };
    for seg in path.data().segments() {
        match seg {
            PathSegment::MoveTo(p) => {
                at = (p.x, p.y);
                start = at;
            }
            PathSegment::LineTo(p) => {
                curve(&mut at, &|_| (p.x, p.y));
            }
            PathSegment::QuadTo(c, p) => {
                let a = at;
                curve(&mut at, &|t| {
                    let u = 1.0 - t;
                    (u * u * a.0 + 2.0 * u * t * c.x + t * t * p.x, u * u * a.1 + 2.0 * u * t * c.y + t * t * p.y)
                });
            }
            PathSegment::CubicTo(c1, c2, p) => {
                let a = at;
                curve(&mut at, &|t| {
                    let u = 1.0 - t;
                    let (k0, k1, k2, k3) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
                    (k0 * a.0 + k1 * c1.x + k2 * c2.x + k3 * p.x, k0 * a.1 + k1 * c1.y + k2 * c2.y + k3 * p.y)
                });
            }
            PathSegment::Close => {
                let s = start;
                curve(&mut at, &|_| s);
            }
        }
    }
    (len > 0.0).then_some(len)
}

/// The SVG `src` with its path `id` (of length `len`, `path_length`) drawn only along its first
/// `frac` (0 to 1) - a dash as long as that, the rest a gap - and, when `track` is above 0, the
/// whole of it once more under that at the opacity `track`: a loading bar in the shape of a
/// logo. The path must be one element closed in itself (`<path ... />`) without a dash of its own.
pub fn progress_svg(src: &str, id: &str, len: f32, frac: f32, track: f32) -> String {
    let Some(at) = [format!("id=\"{id}\""), format!("id='{id}'")].iter().find_map(|a| src.find(a.as_str()).map(|i| (i, a.len()))) else {
        return src.to_string();
    };
    let frac = frac.clamp(0.0, 1.0);
    let dash = if frac <= 0.0005 { " stroke-opacity=\"0\"".to_string() } else { format!(" stroke-dasharray=\"{:.3} {:.3}\"", len * frac, len * 2.0) };
    let mut out = String::with_capacity(src.len() + 256);
    let open = src[..at.0].rfind('<');
    let close = src[at.0..].find("/>").map(|k| at.0 + k + 2);
    match (open, close) {
        (Some(o), Some(c)) if track > 0.0 && !src[at.0..c].contains('<') => {
            // the track: the element as it is, faint, the dashed one after it
            let element = &src[o..c];
            let id_in = at.0 - o;
            out.push_str(&src[..o]);
            out.push_str(&element[..id_in]);
            out.push_str(&format!("stroke-opacity=\"{track:.3}\""));
            out.push_str(&element[id_in + at.1..]);
            out.push_str(&element[..id_in + at.1]);
            out.push_str(&dash);
            out.push_str(&element[id_in + at.1..]);
            out.push_str(&src[c..]);
        }
        _ => {
            out.push_str(&src[..at.0 + at.1]);
            out.push_str(&dash);
            out.push_str(&src[at.0 + at.1..]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    /// A ring round a box and a line under a word, as a logo has it: its length, and drawn
    /// along a part of it.
    const LOGO: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect x="60" y="60" width="80" height="80" fill="#222"/><path id="progress" d="M100 20 A80 80 0 1 0 180 100 L380 100" fill="none" stroke="#2a75f7" stroke-width="16" stroke-linecap="round"/></svg>"##;

    #[test]
    fn a_logo_is_a_loading_bar_along_its_path() {
        // three quarters of a circle of radius 80 and a line of 200
        let len = super::path_length(LOGO, "progress").unwrap();
        let want = 2.0 * std::f32::consts::PI * 80.0 * 0.75 + 200.0;
        assert!((len - want).abs() < want * 0.002, "{len} vs {want}");
        assert!(super::path_length(LOGO, "nothing").is_none());
        let blue = |src: &str| {
            let px = super::rasterize_rgba(src, 400, 200).unwrap();
            // (the end of the line, right; the start of the ring, top)
            let at = |x: usize, y: usize| px[(y * 400 + x) * 4..(y * 400 + x) * 4 + 4].to_vec();
            (at(370, 100), at(100, 20))
        };
        // nothing drawn yet, a faint track
        let (end, start) = blue(&super::progress_svg(LOGO, "progress", len, 0.0, 0.2));
        assert!(end[3] > 20 && end[3] < 90, "{end:?}");
        assert!(start[3] < 90, "{start:?}");
        // half: the ring drawn, the line's end not yet
        let (end, start) = blue(&super::progress_svg(LOGO, "progress", len, 0.5, 0.2));
        assert!(start[3] > 200 && start[2] > 200, "{start:?}");
        assert!(end[3] < 90, "{end:?}");
        // all of it
        let (end, _) = blue(&super::progress_svg(LOGO, "progress", len, 1.0, 0.0));
        assert!(end[3] > 200, "{end:?}");
        // (without a track the element is not doubled; an SVG without the id stays as it is)
        assert_eq!(super::progress_svg(LOGO, "progress", len, 1.0, 0.0).matches("<path").count(), 1);
        assert_eq!(super::progress_svg(LOGO, "progress", len, 1.0, 0.2).matches("<path").count(), 2);
        assert_eq!(super::progress_svg(LOGO, "nothing", len, 0.5, 0.2), LOGO);
    }

    #[test]
    fn stop_request_has_smooth_edges_and_an_open_background() {
        for size in [24, 32, 64] {
            let alpha = super::rasterize("stop_request", size).unwrap();
            assert!(alpha.iter().any(|&a| a > 0 && a < 255), "edges must be anti-aliased");
            assert_eq!(alpha[(size / 4 * size + size / 2) as usize], 0);
            assert_eq!(alpha[(size / 2 * size + size * 3 / 4) as usize], 0, "the bar's interior is transparent");
            assert!(alpha.iter().filter(|&&a| a > 128).count() > (size * size / 12) as usize);
        }
    }

    #[test]
    fn icons_are_built_in_and_draw() {
        assert!(super::names().count() > 50);
        let a = super::rasterize("directions_bus", 32).unwrap();
        assert_eq!(a.len(), 32 * 32);
        let covered = a.iter().filter(|&&v| v > 128).count();
        assert!(covered > 150 && covered < 900, "{covered}");
        assert!(super::rasterize("no_such_icon", 32).is_none());
    }
}
