def run_rules(features):

    depth = features["depth"]["deep_ratio"]
    like_mean = features["like"]["mean"]

    if depth < 0.1:
        structure = "flat"
    elif depth < 0.3:
        structure = "branching"
    else:
        structure = "deep"

    if like_mean < 2:
        engagement = "low"
    elif like_mean < 10:
        engagement = "medium"
    else:
        engagement = "high"

    return {
        "structure": structure,
        "engagement": engagement
    }