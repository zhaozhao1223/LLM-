# Compressed Comment Statistics

This document describes the statistical features used to represent and compress raw comment data.

The module converts raw comment trees into structured statistical summaries through multiple dimensions, including comment structure, user behaviour, engagement feedback, temporal distribution, text behaviour, and thread-level patterns.

These compressed features are used as structured inputs for later analysis modules and LLM agents.

---

# 1. Global Summary

| Field            | Description              | Formula                  |
|------------------|--------------------------|--------------------------|
| `total_comments` | Total number of comments | `N`                      |
| `unique_users`   | Number of unique users   | Count of unique user IDs |
| `hot_ratio`      | Ratio of hot comments    | `hot_count / N`          |

The global summary provides a basic overview of the size and activity level of the comment section.

---

# 2. Depth Structure

This section describes the hierarchical complexity of the comment tree.

| Field        | Description                            | Formula                  |
|--------------|----------------------------------------|--------------------------|
| `mean_depth` | Average comment depth                  | `(1 / N) * sum(depth_i)` |
| `max_depth`  | Maximum comment depth                  | `max(depth_i)`           |
| `deep_ratio` | Ratio of deep comments with depth >= 2 | `count(depth_i >= 2) / N`|
| `histogram`  | Depth distribution                     | `p_k = count_k / N`      |

Depth buckets:

```text
0
1
2
3+
```

A higher depth usually indicates more nested discussion and more complex reply structures.

---

# 3. Branching Structure

This section describes the branching pattern of the comment tree, especially reply relationships.

| Field           | Description                              | Formula                                                 |
|-----------------|------------------------------------------|---------------------------------------------------------|
| `mean_children` | Average number of child comments         | `(1 / N) * sum(children_i)`                             |
| `gini_children` | Inequality of child comment distribution | `G = (2 * sum(i * x_i)) / (n * sum(x_i)) - (n + 1) / n` |
| `histogram`     | Distribution of child comment counts     | `p_k = count_k / N`                                     |

Child comment buckets:

```text
0
1-3
4-10
10+
```

The Gini coefficient indicates whether replies are evenly distributed or concentrated under a small number of comments.

A higher `gini_children` value means that the discussion is more concentrated around a few key comments.

---

# 4. Like and Vote Distribution

This section measures engagement intensity based on likes, votes, or platform-specific score values.

| Field       | Description                     | Formula                 |
|-------------|---------------------------------|-------------------------|
| `mean_like` | Average positive like count     | `(1 / N) * sum(like_i)` |
| `gini_like` | Inequality of like distribution | Same Gini formula       |
| `histogram` | Like count distribution         | `p_k = count_k / N`     |

Like buckets:

```text
0
1-10
11-100
100+
```

For platforms such as Reddit, the original score may be negative because it represents net votes.  
In this case, the system preserves the original score separately and splits it into positive and negative components:

| Field                 | Description                                                                  |
|-----------------------|------------------------------------------------------------------------------|
| `raw_like_count`      | Original platform score, which may be negative                               |
| `positive_like_count` | Positive part of the score, used for normal like-based statistics            |
| `negative_like_count` | Negative score strength, used as a negative engagement or controversy signal |
| `negative_like_ratio` | Normalised negative engagement ratio                                         |

Example:

| Reddit Score | `raw_like_count` | `positive_like_count` | `negative_like_count` |
|---: |---: |--:|---:|
| 25  | 25  | 25| 0  |
| 0   | 0   | 0 | 0  |
| -10 | -10 | 0 | 10 |
| -50 | -50 | 0 | 50 |

This design prevents mathematical errors during logarithmic calculation while still preserving the meaning of negative feedback.

---

# 5. Hot Dynamics

This section describes the potential visibility and influence of comments.

| Field           | Description       | Formula                      |
|-----------------|-------------------|------------------------------|
| `mean_hot_score`| Average hot score | `(1 / N) * sum(hot_score_i)` |
| `max_hot_score` | Maximum hot score | `max(hot_score_i)`           |

## Hot Score Model

The hot score combines positive engagement, reply activity, recency, depth, and negative feedback penalty.

```text
HotScore =
0.4 * LikeScore
+ 0.25 * ReplyScore
+ 0.2 * TimeWeight
+ 0.15 * DepthScore
- 0.15 * NegativePenalty
```

The final score is clipped to avoid negative values:

```text
HotScore = max(0, HotScore)
```

### Like Score

```text
LikeScore = log(1 + positive_like) / max(log(1 + positive_like))
```

Only the positive like count is used in the logarithmic calculation.

### Reply Score

```text
ReplyScore = children / max(children)
```

### Depth Score

```text
DepthScore = 1 - exp(-depth / 2)
```

### Time Weight

```text
TimeWeight = exp(-hours_since / 24)
```

### Negative Penalty

```text
NegativePenalty = negative_like / max(negative_like)
```

The negative penalty is used to reduce the hot score of comments with strong negative feedback, while still preserving the information that those comments may be controversial or strongly opposed.

---

# 6. Temporal Distribution

This section describes the time-related activity pattern of the comment section.

| Field              | Description                         | Formula                       |
|--------------------|-------------------------------------|-------------------------------|
| `mean_hours_since` | Average time since comment creation | `(1 / N) * sum(hours_i)`      |
| `time_span`        | Time span of the comment section    | `max(hours_i) - min(hours_i)` |
| `mean_time_weight` | Average time decay weight           | `(1 / N) * sum(timeWeight_i)` |
| `histogram`        | Time bucket distribution            | `p_k = count_k / N`           |

Time buckets:

```text
0-6h
6-24h
1-3d
3d+
```

This dimension helps identify whether the discussion is recent, old, concentrated in a short period, or spread across a longer time range.

---

# 7. Text Behaviour

This section analyses comment length patterns.

| Field              | Description                 | Formula                |
|--------------------|-----------------------------|------------------------|
| `mean_text_length` | Average comment text length | `(1 / N) * sum(len_i)` |
| `histogram`        | Text length distribution    | `p_k = count_k / N`    |

Text length buckets:

```text
short   (<50)
medium  (50-200)
long    (>200)
```

Longer comments may indicate more detailed discussion, while shorter comments may indicate quick reactions, agreement, disagreement, or low-effort interaction.

---

# 8. Thread-Level Structure

This section analyses the structure of discussion threads.

| Field               | Description                           | Formula                  |
|---------------------|---------------------------------------|--------------------------|
| `total_threads`     | Total number of discussion threads    | `T`                      |
| `mean_thread_size`  | Average number of comments per thread | `(1 / T) * sum(size_t)`  |
| `max_thread_size`   | Maximum thread size                   | `max(size_t)`            |
| `mean_thread_depth` | Average thread depth                  | `(1 / T) * sum(depth_t)` |

Where:

```text
size_t  = number of comments in thread t
depth_t = maximum depth of thread t
```

This dimension helps describe whether the discussion is fragmented into many small threads or concentrated in a few large discussion chains.

---

# 9. Hot Comment Detection

Hot comments are detected using a statistical threshold based on the hot score distribution.

Threshold:

```text
threshold = mean(hotScore) + 0.8 * std(hotScore)
```

Decision rule:

```text
isHot = 1, if hotScore > threshold
isHot = 0, otherwise
```

This approach identifies comments that stand out compared with the overall comment population.

---

# 10. Summary

This statistics module compresses raw comment trees into structured statistical feature vectors.

The main covered dimensions include:

- Comment scale
- Tree depth structure
- Branching and reply structure
- Like and vote distribution
- Negative engagement and controversy signals
- Hot comment dynamics
- Temporal evolution
- Text length behaviour
- Thread-level discussion structure

The final output contains approximately 30 or more statistical features.

These features allow the system to represent the overall behaviour of a comment section without directly passing all raw comments into every analysis stage.