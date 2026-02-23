import json
import subprocess
import sys
import datetime
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Tuple, TypedDict

VIDEO_EXTS = {
    ".mp4",
    ".mov",
    ".mxf",
    ".m4v",
    ".avi",
    ".mkv",
    ".mpg",
    ".mpeg",
}
AUDIO_EXTS = {
    ".wav",
    ".mp3",
    ".aif",
    ".aiff",
    ".aac",
    ".m4a",
    ".flac",
}
IMAGE_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".tif",
    ".tiff",
    ".bmp",
    ".gif",
}
MEDIA_EXTS = VIDEO_EXTS | AUDIO_EXTS | IMAGE_EXTS

class MotionTemplate(TypedDict, total=False):
    scale: float
    center: Tuple[float, float]


DEFAULT_LABEL = "Iris"
DEFAULT_MARKER_COLOR = "4294741314"
REFERENCE_SEQUENCE = "UTCached.xml"
REFERENCE_LABEL_FILE = "label.xml"

RESERVED_VIDEO_TRACKS = 3
RESERVED_AUDIO_TRACKS = 1
VIDEO_CLIP_TRACK_INDEX = RESERVED_VIDEO_TRACKS + 1
AUDIO_CLIP_TRACK_INDEX = RESERVED_AUDIO_TRACKS + 1

SEQUENCE_WIDTH = 1920.0
SEQUENCE_HEIGHT = 960.0
DEFAULT_CENTER = (SEQUENCE_WIDTH / 2, SEQUENCE_HEIGHT / 2)
IMAGE_LEFT_X = 480.0


BASIC_MOTION_TEMPLATES: Dict[Tuple[int, int], MotionTemplate] = {
    (1920, 1080): {"scale": 100.0, "center": DEFAULT_CENTER},
    (1920, 960): {"scale": 90.0, "center": DEFAULT_CENTER},
    (1920, 1920): {"scale": 50.0},
    (960, 960): {"scale": 100.0, "center": (480.0, DEFAULT_CENTER[1])},
    (3840, 1920): {"scale": 50.0, "center": DEFAULT_CENTER},
    (872, 480): {"scale": 222.0, "center": DEFAULT_CENTER},
    (854, 480): {"scale": 225.0, "center": DEFAULT_CENTER},
    (1024, 1024): {"scale": 94.0},
    (1280, 720): {"scale": 150.0, "center": DEFAULT_CENTER},
    (1080, 1080): {"scale": 88.9, "center": (480.0, 480.0)},
    (720, 1280): {"scale": 75.0, "center": DEFAULT_CENTER},
    (1080, 1920): {"scale": 50.0, "center": DEFAULT_CENTER},
    (1280, 700): {"scale": 150.0, "center": DEFAULT_CENTER},
    (480, 854): {"scale": 115.0, "center": DEFAULT_CENTER},
    (2160, 2160): {"scale": 45.0},
    (4209, 1645): {"scale": 41.1, "center": DEFAULT_CENTER},
    (3970, 1273): {"scale": 43.5, "center": DEFAULT_CENTER},
    (3696, 790): {"scale": 46.8, "center": DEFAULT_CENTER},
    (2452, 683): {"scale": 70.4, "center": DEFAULT_CENTER},
    (4096, 1379): {"scale": 42.2, "center": DEFAULT_CENTER},
    (2007, 562): {"scale": 86.1, "center": DEFAULT_CENTER},
}

WIDTH_BASED_SCALE_OVERRIDES: Dict[int, float] = {
    4096: 42.2,
    2452: 70.4,
}
DEFAULT_MOTION_TEMPLATE: MotionTemplate = {
    "scale": 100.0,
    "center": DEFAULT_CENTER,
}

DIMENSIONS_CACHE: Dict[Path, Tuple[int, int]] = {}


def seconds_to_frames(seconds: float, fps: float) -> int:
    return int(round(seconds * fps))


def is_media_file(path: Path) -> bool:
    name_lower = path.name.lower()
    if "sqlite" in name_lower:
        return False
    return path.suffix.lower() in MEDIA_EXTS


def media_category(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in AUDIO_EXTS:
        return "audio"
    if ext in IMAGE_EXTS:
        return "image"
    return "video"


def get_media_duration_seconds(media_path: Path, default_seconds: float) -> float:
    """
    Возвращает длительность медиа через ffprobe. При любой ошибке вернёт default_seconds.
    """
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(media_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
        )
        output = result.stdout.strip()
        if not output:
            return default_seconds
        duration = float(output)
        if duration <= 0:
            return default_seconds
        return duration
    except Exception:
        return default_seconds


def collect_root_media(root: Path) -> List[Path]:
    """
    Файлы только из корня UTCache, без подпапок.
    Игнорируем sqlite. Сортируем по дате изменения (старые сначала).
    """
    files = [
        entry
        for entry in root.iterdir()
        if entry.is_file() and is_media_file(entry)
    ]
    files.sort(key=lambda p: (p.stat().st_mtime, p.name))
    return files


def collect_media_recursively(folder: Path) -> List[Path]:
    """Возвращает все медиа внутри папки (с подпапками)."""
    files: List[Path] = [
        entry
        for entry in folder.rglob("*")
        if entry.is_file() and is_media_file(entry)
    ]
    files.sort(key=lambda p: (p.stat().st_mtime, p.name))
    return files


def collect_subfolders_with_media(root: Path) -> List[tuple[Path, List[Path]]]:
    """
    Только ПРЯМЫЕ подпапки UTCache.
    Игнорируем папку UNSORTED.
    В каждой подпапке берём все файлы (с рекурсией), фильтруем sqlite.
    """
    result: List[tuple[Path, List[Path]]] = []
    for entry in sorted(root.iterdir(), key=lambda p: p.name):
        if not entry.is_dir():
            continue
        if entry.name == "UNSORTED":
            continue

        media_files = collect_media_recursively(entry)
        result.append((entry, media_files))

    return result


def create_rate_element(parent: ET.Element, timebase: str) -> ET.Element:
    rate_elem = ET.SubElement(parent, "rate")
    ET.SubElement(rate_elem, "timebase").text = timebase
    ET.SubElement(rate_elem, "ntsc").text = "FALSE"
    return rate_elem


def append_logging_and_labels(
    node: ET.Element,
    label_text: str = "Forest",
) -> None:
    labels_elem = ET.SubElement(node, "labels")
    ET.SubElement(labels_elem, "label2").text = label_text

    logginginfo_elem = ET.SubElement(node, "logginginfo")
    for tag in [
        "description",
        "scene",
        "shottake",
        "lognote",
        "good",
        "originalvideofilename",
        "originalaudiofilename",
    ]:
        ET.SubElement(logginginfo_elem, tag)


def format_number(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.4f}".rstrip("0").rstrip(".")


def detect_label_name(root_folder: Path, default_label: str = DEFAULT_LABEL) -> str:
    """
    Пытается взять label2 из UTCached.xml, затем label.xml, иначе возвращает default.
    """
    reference_paths = [
        root_folder / REFERENCE_SEQUENCE,
        root_folder / REFERENCE_LABEL_FILE,
    ]
    for path in reference_paths:
        if not path.exists():
            continue
        try:
            tree = ET.parse(path)
            node = tree.find(".//label2")
            if node is not None and node.text and node.text.strip():
                value = node.text.strip()
                if value.lower() == "forest" and default_label.lower() != "forest":
                    continue
                return value
        except Exception:
            continue
    return default_label


def detect_marker_color(root_folder: Path, default_color: str = DEFAULT_MARKER_COLOR) -> str:
    """
    Берёт pproColor первого маркера из UTCached.xml, если есть.
    """
    reference_file = root_folder / REFERENCE_SEQUENCE
    if not reference_file.exists():
        return default_color
    try:
        tree = ET.parse(reference_file)
        node = tree.find(".//marker/pproColor")
        if node is not None and node.text and node.text.strip():
            return node.text.strip()
    except Exception:
        pass
    return default_color


def probe_media_dimensions(path: Path) -> Tuple[int, int] | None:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        str(path),
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return None

    if result.returncode != 0 or not result.stdout:
        return None

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None

    streams = payload.get("streams")
    if not streams:
        return None

    stream = streams[0]
    width = stream.get("width")
    height = stream.get("height")
    if isinstance(width, int) and isinstance(height, int):
        return width, height
    return None


def probe_image_dimensions(path: Path) -> Tuple[int, int] | None:
    try:
        from PIL import Image  # type: ignore[import-untyped]
    except ImportError:
        return None

    try:
        with Image.open(path) as img:
            return int(img.width), int(img.height)
    except Exception:
        return None


def get_media_dimensions(path: Path) -> Tuple[int, int] | None:
    if path in DIMENSIONS_CACHE:
        return DIMENSIONS_CACHE[path]
    dims = probe_media_dimensions(path)
    if dims is None and path.suffix.lower() in IMAGE_EXTS:
        dims = probe_image_dimensions(path)
    if dims:
        DIMENSIONS_CACHE[path] = dims
    return dims


def encode_center_values(center_px: Tuple[float, float]) -> Tuple[float, float]:
    half_w = SEQUENCE_WIDTH / 2
    half_h = SEQUENCE_HEIGHT / 2
    x_px, y_px = center_px
    encoded_x = (x_px - half_w) / half_w
    encoded_y = (y_px - half_h) / half_h
    return encoded_x, encoded_y


def pick_motion_template(dimensions: Tuple[int, int] | None) -> MotionTemplate:
    if dimensions and dimensions in BASIC_MOTION_TEMPLATES:
        return BASIC_MOTION_TEMPLATES[dimensions]
    return DEFAULT_MOTION_TEMPLATE


def resolve_center(
    category: str,
    source_dimensions: Tuple[int, int] | None,
    template_center: Tuple[float, float] | None,
    scale_value: float,
) -> Tuple[float, float]:
    if template_center is not None:
        return template_center
    if category == "image":
        # Premiere expects left-aligned images to encode their horizontal center
        # as a normalized value that depends on the current scale. Empirically
        # this is -scale/200 (see working reference XML), which results in
        # Position X ≈ 480 inside the UI regardless of the underlying source size.
        center_norm = -scale_value / 200.0
        center_px = center_norm * (SEQUENCE_WIDTH / 2) + (SEQUENCE_WIDTH / 2)
        return (center_px, DEFAULT_CENTER[1])
    return DEFAULT_CENTER


def append_basic_motion_filter(
    clipitem: ET.Element,
    scale_value: float,
    center_value: Tuple[float, float],
) -> None:
    filter_elem = ET.SubElement(clipitem, "filter")
    effect = ET.SubElement(filter_elem, "effect")
    ET.SubElement(effect, "name").text = "Basic Motion"
    ET.SubElement(effect, "effectid").text = "basic"
    ET.SubElement(effect, "effectcategory").text = "motion"
    ET.SubElement(effect, "effecttype").text = "motion"
    ET.SubElement(effect, "mediatype").text = "video"
    ET.SubElement(effect, "pproBypass").text = "false"

    def add_parameter(param_id: str, name: str, value: str | Tuple[str, str], **extra: str) -> None:
        param = ET.SubElement(effect, "parameter", authoringApp="PremierePro")
        ET.SubElement(param, "parameterid").text = param_id
        ET.SubElement(param, "name").text = name
        for key, val in extra.items():
            ET.SubElement(param, key).text = val
        if isinstance(value, tuple):
            value_elem = ET.SubElement(param, "value")
            ET.SubElement(value_elem, "horiz").text = value[0]
            ET.SubElement(value_elem, "vert").text = value[1]
        else:
            ET.SubElement(param, "value").text = value

    add_parameter(
        "scale",
        "Scale",
        format_number(scale_value),
        valuemin="0",
        valuemax="1000",
    )
    add_parameter(
        "rotation",
        "Rotation",
        "0",
        valuemin="-8640",
        valuemax="8640",
    )
    center_tuple = (
        format_number(center_value[0]),
        format_number(center_value[1]),
    )
    add_parameter("center", "Center", center_tuple)
    add_parameter("centerOffset", "Anchor Point", ("0", "0"))
    add_parameter(
        "antiflicker",
        "Anti-flicker Filter",
        "0",
        valuemin="0.0",
        valuemax="1.0",
    )


def create_file_element(
    parent: ET.Element,
    file_id: str,
    media_path: Path,
    clip_duration_frames: int,
    fps_value: str,
    include_video: bool,
    include_audio: bool,
    source_dimensions: Tuple[int, int] | None = None,
) -> ET.Element:
    file_elem = ET.SubElement(parent, "file", id=file_id)
    ET.SubElement(file_elem, "name").text = media_path.name
    ET.SubElement(file_elem, "pathurl").text = media_path.resolve().as_uri()
    create_rate_element(file_elem, fps_value)
    ET.SubElement(file_elem, "duration").text = str(clip_duration_frames)

    timecode = ET.SubElement(file_elem, "timecode")
    create_rate_element(timecode, fps_value)
    ET.SubElement(timecode, "string").text = "00:00:00:00"
    ET.SubElement(timecode, "frame").text = "0"
    ET.SubElement(timecode, "displayformat").text = "NDF"

    media_elem = ET.SubElement(file_elem, "media")
    if include_video:
        width_value = "1920"
        height_value = "1080"
        if source_dimensions:
            width_value = str(source_dimensions[0])
            height_value = str(source_dimensions[1])

        video_meta = ET.SubElement(media_elem, "video")
        sample_char = ET.SubElement(video_meta, "samplecharacteristics")
        create_rate_element(sample_char, fps_value)
        ET.SubElement(sample_char, "width").text = width_value
        ET.SubElement(sample_char, "height").text = height_value
        ET.SubElement(sample_char, "anamorphic").text = "FALSE"
        ET.SubElement(sample_char, "pixelaspectratio").text = "square"
        ET.SubElement(sample_char, "fielddominance").text = "none"

    if include_audio:
        audio_meta = ET.SubElement(media_elem, "audio")
        sample_char = ET.SubElement(audio_meta, "samplecharacteristics")
        ET.SubElement(sample_char, "depth").text = "16"
        ET.SubElement(sample_char, "samplerate").text = "48000"
        ET.SubElement(audio_meta, "channelcount").text = "2"

    return file_elem


def utcache_to_xml_timeline(
    root_folder_path: str,
    output_xml_base_path: str,
    fps: float = 50.0,
    default_clip_duration_seconds: float = 5.0,
    default_marker_duration_seconds: float = 0.0,
) -> str:
    """
    Строит FCP XML с одной секвенцией, похожей на UT_GFX_1.xml:
      - Маркер 'UTCache' + маркеры для подпапок.
      - Видео-дорожка с клипами.
      - Пара стерео-аудиодорожек, линки между видео и аудио клипами.
    """
    root_folder = Path(root_folder_path)
    if not root_folder.exists():
        raise FileNotFoundError(f"Root folder not found: {root_folder}")

    print(f"🔍 Scanning '{root_folder}'...", flush=True)
    label_name = detect_label_name(root_folder)
    marker_color = detect_marker_color(root_folder)
    print(f"🎨 Using label '{label_name}' for clips.", flush=True)
    print(f"🖍  Using marker color '{marker_color}'.", flush=True)
    root_media = collect_root_media(root_folder)
    subfolders_with_media = collect_subfolders_with_media(root_folder)

    if not root_media and not subfolders_with_media:
        raise ValueError(
            "No media files found in UTCache (root or subfolders)."
        )

    total_files = len(root_media) + sum(len(files) for _, files in subfolders_with_media)
    print(
        f"📦 Found {len(root_media)} root files and {len(subfolders_with_media)} subfolders "
        f"({total_files} media items total).",
        flush=True,
    )

    fps_float = float(fps)
    fps_value = str(int(fps_float)) if fps_float.is_integer() else str(fps_float)
    default_clip_duration_frames = seconds_to_frames(
        default_clip_duration_seconds,
        fps_float,
    )
    default_marker_duration_frames = seconds_to_frames(
        default_marker_duration_seconds,
        fps_float,
    )
    folder_marker_duration_frames = seconds_to_frames(10.0, fps_float)

    root = ET.Element("xmeml", version="4")
    sequence = ET.SubElement(root, "sequence", id="sequence-1")
    ET.SubElement(sequence, "uuid").text = "00000000-0000-0000-0000-000000000000"
    ET.SubElement(sequence, "duration").text = "0"
    create_rate_element(sequence, fps_value)
    ET.SubElement(sequence, "name").text = root_folder.name

    media_elem = ET.SubElement(sequence, "media")
    video_elem = ET.SubElement(media_elem, "video")
    video_format = ET.SubElement(video_elem, "format")
    video_sample_char = ET.SubElement(video_format, "samplecharacteristics")
    create_rate_element(video_sample_char, fps_value)
    ET.SubElement(video_sample_char, "width").text = "1920"
    ET.SubElement(video_sample_char, "height").text = "960"
    ET.SubElement(video_sample_char, "anamorphic").text = "FALSE"
    ET.SubElement(video_sample_char, "pixelaspectratio").text = "square"
    ET.SubElement(video_sample_char, "fielddominance").text = "none"
    ET.SubElement(video_sample_char, "colordepth").text = "24"

    for _ in range(RESERVED_VIDEO_TRACKS):
        reserved_track = ET.SubElement(video_elem, "track")
        ET.SubElement(reserved_track, "enabled").text = "TRUE"
        ET.SubElement(reserved_track, "locked").text = "TRUE"

    video_track = ET.SubElement(video_elem, "track")
    ET.SubElement(video_track, "enabled").text = "TRUE"
    ET.SubElement(video_track, "locked").text = "FALSE"

    audio_elem = ET.SubElement(media_elem, "audio")
    ET.SubElement(audio_elem, "numOutputChannels").text = "2"
    audio_format = ET.SubElement(audio_elem, "format")
    audio_sample_char = ET.SubElement(audio_format, "samplecharacteristics")
    ET.SubElement(audio_sample_char, "depth").text = "16"
    ET.SubElement(audio_sample_char, "samplerate").text = "48000"

    outputs_elem = ET.SubElement(audio_elem, "outputs")
    for group_idx in (1, 2):
        group = ET.SubElement(outputs_elem, "group")
        ET.SubElement(group, "index").text = str(group_idx)
        ET.SubElement(group, "numchannels").text = "1"
        ET.SubElement(group, "downmix").text = "0"
        channel = ET.SubElement(group, "channel")
        ET.SubElement(channel, "index").text = str(group_idx)

    audio_tracks: list[ET.Element] = []
    audio_track_clip_indices = []
    for idx in range(RESERVED_AUDIO_TRACKS):
        reserved_audio_track = ET.SubElement(audio_elem, "track")
        ET.SubElement(reserved_audio_track, "enabled").text = "TRUE"
        ET.SubElement(reserved_audio_track, "locked").text = "TRUE"
        ET.SubElement(reserved_audio_track, "outputchannelindex").text = str(idx + 1)

    track = ET.SubElement(audio_elem, "track")
    ET.SubElement(track, "enabled").text = "TRUE"
    ET.SubElement(track, "locked").text = "FALSE"
    ET.SubElement(track, "outputchannelindex").text = str(AUDIO_CLIP_TRACK_INDEX)
    audio_tracks.append(track)
    audio_track_clip_indices.append(1)

    timecode_elem = ET.SubElement(sequence, "timecode")
    create_rate_element(timecode_elem, fps_value)
    ET.SubElement(timecode_elem, "string").text = "00:00:00:00"
    ET.SubElement(timecode_elem, "frame").text = "0"
    ET.SubElement(timecode_elem, "displayformat").text = "NDF"

    # ---- TIMELINE CONTENT ----
    group_entries: list[tuple[Path, str, List[Path]]] = [
        (root_folder, "UTCache", root_media)
    ]
    group_entries.extend((folder, folder.name, files) for folder, files in subfolders_with_media)
    group_entries.sort(
        key=lambda item: (item[0].stat().st_mtime, item[1]),
        reverse=True,
    )

    current_frame = 0
    clip_counter = 1
    file_counter = 1
    masterclip_counter = 1
    video_clip_index = 1
    markers_to_emit: list[tuple[str, int, int]] = []
    processed_files = 0

    for folder_path, folder_name, media_files in group_entries:
        marker_in = current_frame
        marker_out = marker_in + folder_marker_duration_frames
        markers_to_emit.append((folder_name, marker_in, marker_out))
        current_frame += folder_marker_duration_frames
        print(
            f"\n📁 Processing folder '{folder_name}' ({len(media_files)} files, "
            f"modified {datetime.datetime.fromtimestamp(folder_path.stat().st_mtime):%Y-%m-%d %H:%M:%S})...",
            flush=True,
        )

        for media_path in media_files:
            category = media_category(media_path)
            has_video_track = category in {"video", "image"}
            has_audio_track = category in {"video", "audio"}
            duration_seconds = get_media_duration_seconds(
                media_path,
                default_clip_duration_seconds,
            )
            if category == "image":
                duration_seconds = max(duration_seconds, 5.0)
            clip_duration_frames = max(
                1,
                seconds_to_frames(duration_seconds, fps_float),
            )
            start = current_frame
            end = start + clip_duration_frames

            masterclip_id = f"masterclip-{masterclip_counter}"
            masterclip_counter += 1
            file_id = f"file-{file_counter}"
            file_counter += 1

            video_clip_id = ""
            video_clip_position: int | None = None
            source_dimensions: Tuple[int, int] | None = None
            audio_clip_id: str | None = None
            audio_clip_element: ET.Element | None = None
            audio_clip_index: int | None = None

            if has_video_track:
                video_clip_id = f"clipitem-{clip_counter}"
                clip_counter += 1
                clipitem = ET.SubElement(video_track, "clipitem", id=video_clip_id)
                ET.SubElement(clipitem, "masterclipid").text = masterclip_id
                ET.SubElement(clipitem, "name").text = media_path.name
                ET.SubElement(clipitem, "enabled").text = "TRUE"
                ET.SubElement(clipitem, "duration").text = str(clip_duration_frames)
                create_rate_element(clipitem, fps_value)
                ET.SubElement(clipitem, "start").text = str(start)
                ET.SubElement(clipitem, "end").text = str(end)
                ET.SubElement(clipitem, "in").text = "0"
                ET.SubElement(clipitem, "out").text = str(clip_duration_frames)
                ET.SubElement(clipitem, "alphatype").text = (
                    "straight" if category == "image" else "none"
                )
                ET.SubElement(clipitem, "pixelaspectratio").text = "square"
                ET.SubElement(clipitem, "anamorphic").text = "FALSE"

                source_dimensions = get_media_dimensions(media_path)
                motion_template = pick_motion_template(source_dimensions)
                scale_value = motion_template.get("scale")
                if scale_value is None:
                    scale_value = DEFAULT_MOTION_TEMPLATE["scale"]
                if source_dimensions:
                    width, height = source_dimensions
                    if (
                        (width, height) not in BASIC_MOTION_TEMPLATES
                        and width == 1920
                        and height != 1080
                    ):
                        scale_value = 90.0
                    elif (
                        (width, height) not in BASIC_MOTION_TEMPLATES
                        and width in WIDTH_BASED_SCALE_OVERRIDES
                    ):
                        scale_value = WIDTH_BASED_SCALE_OVERRIDES[width]

                center_value = resolve_center(
                    category,
                    source_dimensions,
                    motion_template.get("center"),
                    scale_value,
                )

                create_file_element(
                    clipitem,
                    file_id,
                    media_path,
                    clip_duration_frames,
                    fps_value,
                    include_video=True,
                    include_audio=has_audio_track,
                    source_dimensions=source_dimensions,
                )
                append_basic_motion_filter(
                    clipitem,
                    scale_value,
                    encode_center_values(center_value),
                )

                link = ET.SubElement(clipitem, "link")
                ET.SubElement(link, "linkclipref").text = video_clip_id
                ET.SubElement(link, "mediatype").text = "video"
                ET.SubElement(link, "trackindex").text = str(VIDEO_CLIP_TRACK_INDEX)
                video_clip_position = video_clip_index
                ET.SubElement(link, "clipindex").text = str(video_clip_position)
                video_clip_index += 1

            if has_audio_track:
                track_elem = audio_tracks[0]
                list_index = 0
                audio_clip_id = f"clipitem-{clip_counter}"
                clip_counter += 1
                audio_clip = ET.SubElement(
                    track_elem,
                    "clipitem",
                    id=audio_clip_id,
                    premiereChannelType="stereo",
                )
                audio_clip_element = audio_clip
                ET.SubElement(audio_clip, "masterclipid").text = masterclip_id
                ET.SubElement(audio_clip, "name").text = media_path.name
                ET.SubElement(audio_clip, "enabled").text = "TRUE"
                ET.SubElement(audio_clip, "duration").text = str(clip_duration_frames)
                create_rate_element(audio_clip, fps_value)
                ET.SubElement(audio_clip, "start").text = str(start)
                ET.SubElement(audio_clip, "end").text = str(end)
                ET.SubElement(audio_clip, "in").text = "0"
                ET.SubElement(audio_clip, "out").text = str(clip_duration_frames)

                if has_video_track:
                    ET.SubElement(audio_clip, "file", id=file_id)
                else:
                    create_file_element(
                        audio_clip,
                        file_id,
                        media_path,
                        clip_duration_frames,
                        fps_value,
                        include_video=False,
                        include_audio=True,
                    )

                sourcetrack = ET.SubElement(audio_clip, "sourcetrack")
                ET.SubElement(sourcetrack, "mediatype").text = "audio"
                ET.SubElement(sourcetrack, "trackindex").text = str(AUDIO_CLIP_TRACK_INDEX)

                audio_clip_index = audio_track_clip_indices[list_index]
                audio_track_clip_indices[list_index] += 1
                append_logging_and_labels(audio_clip, label_name)

            if has_video_track:
                append_logging_and_labels(clipitem, label_name)

            if has_video_track and audio_clip_id and audio_clip_element is not None:
                link = ET.SubElement(clipitem, "link")
                ET.SubElement(link, "linkclipref").text = audio_clip_id
                ET.SubElement(link, "mediatype").text = "audio"
                ET.SubElement(link, "trackindex").text = str(AUDIO_CLIP_TRACK_INDEX)
                ET.SubElement(link, "clipindex").text = str(audio_clip_index or 1)
                ET.SubElement(link, "groupindex").text = "1"

                link_audio = ET.SubElement(audio_clip_element, "link")
                ET.SubElement(link_audio, "linkclipref").text = video_clip_id
                ET.SubElement(link_audio, "mediatype").text = "video"
                ET.SubElement(link_audio, "trackindex").text = str(VIDEO_CLIP_TRACK_INDEX)
                ET.SubElement(link_audio, "clipindex").text = str(
                    video_clip_position or video_clip_index
                )
                ET.SubElement(link_audio, "groupindex").text = "1"

            current_frame = end
            processed_files += 1
            print(
                f"   ✅ [{processed_files}/{total_files}] {media_path.name} "
                f"({duration_seconds:.2f}s)",
                flush=True,
            )

    for marker_name, marker_in, marker_out in markers_to_emit:
        marker = ET.SubElement(sequence, "marker")
        ET.SubElement(marker, "comment")
        ET.SubElement(marker, "name").text = marker_name
        ET.SubElement(marker, "in").text = str(marker_in)
        ET.SubElement(marker, "out").text = str(marker_out)
        ET.SubElement(marker, "pproColor").text = marker_color

    append_logging_and_labels(sequence, label_name)

    duration_elem = sequence.find("duration")
    if duration_elem is None:
        duration_elem = ET.SubElement(sequence, "duration")
    duration_elem.text = str(current_frame)

    current_date = datetime.datetime.now().strftime("%d%m%y")
    output_xml = Path(output_xml_base_path)
    output_xml_path = output_xml / f"{output_xml.name}_{current_date}.xml"
    xml_bytes = ET.tostring(root, encoding="utf-8")
    with open(output_xml_path, "wb") as handle:
        handle.write(b'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n')
        handle.write(xml_bytes)

    return str(output_xml_path)


def main() -> None:
    # По умолчанию используем директорию, где лежит скрипт.
    script_dir = Path(__file__).resolve().parent
    configured_root = Path("/Users/kkmac2/Yandex.Disk.localized/UT/UTCache")
    default_root_path = script_dir if script_dir.is_dir() else configured_root
    default_root = str(default_root_path)

    if len(sys.argv) > 1:
        root_input = sys.argv[1]
    else:
        root_input = default_root

    root_folder = (
        Path(root_input.strip().strip('"').strip("'"))
        .expanduser()
        .resolve()
    )
    if not root_folder.is_dir():
        raise NotADirectoryError(f"Not a folder: {root_folder}")

    # XML создаём внутри UTCache, имя типа UTCache/UTCache_ДДММГГ.xml
    output_xml_base_path = str(root_folder)
    saved_path = utcache_to_xml_timeline(
        str(root_folder),
        output_xml_base_path,
        fps=50.0,
        default_clip_duration_seconds=10.0,
        default_marker_duration_seconds=0.0,
    )
    print(f"XML file saved to {saved_path}")


if __name__ == "__main__":
    main()
