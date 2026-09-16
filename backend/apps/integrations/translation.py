COMMON_TRANSLATIONS = {
    "hi": {
        "Low": "कम",
        "Moderate": "मध्यम",
        "High": "उच्च",
        "Severe": "गंभीर",
        "Evacuate immediately": "तुरंत खाली करें",
        "Landslide threat elevated": "भूस्खलन का खतरा बढ़ गया है",
    },
    "as": {
        "Low": "কম",
        "Moderate": "মধ্যমীয়া",
        "High": "উচ্চ",
        "Severe": "ভয়াৱহ",
        "Evacuate immediately": "অবিলম্বে স্থান ত্যাগ কৰক",
        "Landslide threat elevated": "ভূমিস্খলনৰ আশংকা বৃদ্ধি পাইছে",
    },
    "bn": {
        "Low": "কম",
        "Moderate": "মাঝারি",
        "High": "উচ্চ",
        "Severe": "মারাত্মক",
        "Evacuate immediately": "অবিলম্বে নিরাপদ স্থানে যান",
        "Landslide threat elevated": "ভূমিধসের ঝুঁকি বৃদ্ধি পেয়েছে",
    },
}

def translate_text(text: str, target_lang: str) -> str:
    if not text or target_lang == "en":
        return text

    target_lang = target_lang.lower().strip()
    dict_trans = COMMON_TRANSLATIONS.get(target_lang, {})
    for src, dst in dict_trans.items():
        if src.lower() in text.lower():
            text = text.replace(src, dst)

    return text
