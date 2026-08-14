from collections import defaultdict
from app.engine.clustering import HDBSCANBERTClusterer


def gini(values):
    """计算 Gini 系数，衡量分布不均衡度。0=完全均等，1=完全不均等。"""
    n = len(values)
    if n < 2:
        return 0.0
    sorted_vals = sorted(values)
    if sorted_vals[-1] == 0:
        return 0.0
    total = sum(sorted_vals)
    weighted_sum = sum((i + 1) * x for i, x in enumerate(sorted_vals))
    return round((2 * weighted_sum) / (n * total) - (n + 1) / n, 4)


def compress_comments(comments):

    N = len(comments)
    if N == 0:
        return {}

    users = set()

    hot_count = 0

    sum_depth = 0
    max_depth = 0
    deep_count = 0

    sum_children = 0
    sum_like = 0
    sum_hot_score = 0

    sum_text_len = 0

    sum_hours = 0
    min_hours = float("inf")
    max_hours = 0

    sum_time_weight = 0

    like_values = []
    children_values = []

    depth_hist = [0,0,0,0]      # 0,1,2,3+
    branch_hist = [0,0,0,0]     # 0,1-3,4-10,10+
    like_hist = [0,0,0,0]       # 0,1-10,11-100,100+
    time_hist = [0,0,0,0]       # 0-6h,6-24h,1-3d,3d+
    length_hist = [0,0,0]       # short,medium,long

    thread_map = defaultdict(list)

    for c in comments:

        users.add(c.user_id)

        depth = c.real_depth or 0
        children = c.children_count or 0
        like = c.like_count or 0
        hot_score = c.hot_score or 0
        text_len = c.text_length or 0
        hours = c.hours_since or 0
        time_weight = c.time_weight or 0

        if c.is_hot:
            hot_count += 1

        # depth
        sum_depth += depth
        if depth > max_depth:
            max_depth = depth
        if depth >= 2:
            deep_count += 1

        if depth >= 3:
            depth_hist[3] += 1
        else:
            depth_hist[depth] += 1

        # branching
        sum_children += children
        children_values.append(children)

        if children == 0:
            branch_hist[0] += 1
        elif children <= 3:
            branch_hist[1] += 1
        elif children <= 10:
            branch_hist[2] += 1
        else:
            branch_hist[3] += 1

        # likes
        sum_like += like
        like_values.append(like)

        if like == 0:
            like_hist[0] += 1
        elif like <= 10:
            like_hist[1] += 1
        elif like <= 100:
            like_hist[2] += 1
        else:
            like_hist[3] += 1

        # hot score
        sum_hot_score += hot_score

        # text
        sum_text_len += text_len

        if text_len < 50:
            length_hist[0] += 1
        elif text_len <= 200:
            length_hist[1] += 1
        else:
            length_hist[2] += 1

        # time
        sum_hours += hours
        sum_time_weight += time_weight

        if hours < min_hours:
            min_hours = hours
        if hours > max_hours:
            max_hours = hours

        if hours <= 6:
            time_hist[0] += 1
        elif hours <= 24:
            time_hist[1] += 1
        elif hours <= 72:
            time_hist[2] += 1
        else:
            time_hist[3] += 1

        # thread
        thread_map[c.root_id].append(c)

    # thread stats
    thread_count = len(thread_map)

    sum_thread_size = 0
    max_thread_size = 0
    sum_thread_depth = 0

    for thread in thread_map.values():

        size = len(thread)
        sum_thread_size += size

        if size > max_thread_size:
            max_thread_size = size

        depth = 0
        for c in thread:
            if c.real_depth > depth:
                depth = c.real_depth

        sum_thread_depth += depth

    # normalize histogram
    def norm(arr):
        return [round(v/N,4) for v in arr]

    return {

        "global": {
            "n": N,
            "users": len(users),
            "hot_ratio": round(hot_count/N,4)
        },

        "depth": {
            "mean": round(sum_depth/N,3),
            "max": max_depth,
            "deep_ratio": round(deep_count/N,4),
            "hist": norm(depth_hist)
        },

        "branch": {
            "mean": round(sum_children/N,3),
            "gini_children": gini(children_values),
            "hist": norm(branch_hist)
        },

        "like": {
            "mean": round(sum_like/N,3),
            "gini_like": gini(like_values),
            "hist": norm(like_hist)
        },

        "hot": {
            "mean": round(sum_hot_score/N,4)
        },

        "time": {
            "mean_h": round(sum_hours/N,2),
            "span_h": round(max_hours-min_hours,2),
            "weight": round(sum_time_weight/N,4),
            "hist": norm(time_hist)
        },

        "text": {
            "mean_len": round(sum_text_len/N,2),
            "hist": norm(length_hist)
        },

        "thread": {
            "count": thread_count,
            "mean_size": round(sum_thread_size/thread_count,2) if thread_count else 0,
            "max_size": max_thread_size,
            "mean_depth": round(sum_thread_depth/thread_count,2) if thread_count else 0
        }
    }

def pick_features_for_structural(full_features: dict) -> dict:
    return {
        "depth": full_features.get("depth"),
        "branch": full_features.get("branch"),
        "thread": full_features.get("thread"),
        "gini_children": full_features.get("branch", {}).get("gini_children")
    }

def pick_features_for_engagement(full_features: dict) -> dict:
    g = full_features.get("global", {})
    like = full_features.get("like", {})
    return {
        "n": g.get("n"),
        "users": g.get("users"),
        "hot_ratio": g.get("hot_ratio"),
        "gini_like": like.get("gini_like"),
        "gini_children": full_features.get("branch", {}).get("gini_children"),
        "like": {"mean": like.get("mean"), "hist": like.get("hist")},
        "hot": full_features.get("hot")
    }

def pick_features_for_temporal(full_features: dict) -> dict:
    return {"time": full_features.get("time")}

def pick_features_for_quality(full_features: dict) -> dict:
    return {
        "text": full_features.get("text"),
        "depth": full_features.get("depth"),   # 深度异常可能暗示低质灌水
        "like": {"mean": full_features.get("like", {}).get("mean")}  # 仅均值
    }

def cluster_comments(comments, post_text):
    n = len(comments)

    if n < 50:
        cluster = HDBSCANBERTClusterer(min_cluster_size = 3, min_samples = 1,umap_components = 5, umap_neighbors = 4)
    elif n < 100:
        cluster = HDBSCANBERTClusterer(min_cluster_size = 4, min_samples = 1,umap_components = 8, umap_neighbors = 5)
    elif n < 200:
        cluster = HDBSCANBERTClusterer(min_cluster_size = 4, min_samples = 2,umap_components = 20, umap_neighbors = 8)
    elif n < 350:
        cluster = HDBSCANBERTClusterer(min_cluster_size = 5, min_samples = 2,umap_components = 20, umap_neighbors = 10)
    else:
        cluster = HDBSCANBERTClusterer(min_cluster_size = 6, min_samples = 3,umap_components = 25, umap_neighbors = 12)

    comments_list = list(comments.values())
    labels = cluster.fit(comments_list, preprocess= True)

    clustered_comments = {}
    for comment, label in zip(comments_list, labels):
        if label not in clustered_comments:
            clustered_comments[label] = []
        clustered_comments[label].append(comment)

    relevant_comments, _ = cluster.filter_relevant_comments(
        post_text=post_text,
        min_cluster_size=2,
        relevance_threshold=0.3
    )
    # print("筛选后的评论：",relevant_comments)


    # clustered_comments = {label: [] for label in set(labels)}
    # for comment, label in zip(comments_list, labels):
    #     clustered_comments[label].append(comment)
    return relevant_comments


