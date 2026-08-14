import numpy as np
import pandas as pd
import re
from typing import List, Dict, Tuple, Optional
import warnings
import logging
from collections import defaultdict
import os

warnings.filterwarnings('ignore')

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)-8s | %(filename)s:%(lineno)d | %(funcName)s | %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Core libraries
# os.environ['TRANSFORMERS_OFFLINE'] = '1'      # transformers 库强制离线
# os.environ['HF_HUB_OFFLINE'] = '1'            # huggingface_hub 强制离线
from sentence_transformers import SentenceTransformer
import hdbscan
import umap
from sklearn.metrics import silhouette_score, calinski_harabasz_score

# Optional: for visualization
try:
    import matplotlib.pyplot as plt
    import seaborn as sns

    VISUALIZATION_AVAILABLE = True
    logger.info("Visualization libraries successfully imported")
except ImportError as e:
    VISUALIZATION_AVAILABLE = False
    logger.warning(f"Visualization libraries not available: {e}")


class HDBSCANBERTClusterer:
    """
    Comment clustering based on HDBSCAN and BERT
    Supports Chinese and English comments
    """

    def __init__(
            self,
            model_name: str = 'paraphrase-multilingual-MiniLM-L12-v2',  # Multilingual model supporting Chinese
            min_cluster_size: int = 5,  # Minimum cluster size
            min_samples: int = 2,  # Minimum neighbors required for core points
            umap_components: int = 5,  # UMAP reduction dimension
            umap_neighbors: int = 15,  # Number of UMAP neighbors
            umap_random_state: int = 42,  # UMAP random seed
            cluster_selection_method: str = 'eom',  # 'eom' or 'leaf'
            metric: str = 'euclidean',  # Distance metric
            use_gpu: bool = False  # Whether to use GPU acceleration
    ):
        """
        Initialize clusterer

        Args:
            model_name: Sentence-BERT model name
            min_cluster_size: HDBSCAN minimum cluster size (adjust based on data size)
            min_samples: HDBSCAN parameter controlling noise point identification
            umap_components: Dimension after UMAP reduction
            umap_neighbors: UMAP local neighborhood size
            cluster_selection_method: Cluster selection method
            metric: Distance metric
            use_gpu: Whether to use GPU
        """
        logger.info(
            f"Initializing HDBSCANBERTClusterer with parameters: min_cluster_size={min_cluster_size}, min_samples={min_samples}, umap_components={umap_components}")

        self.min_cluster_size = min_cluster_size
        self.min_samples = min_samples
        self.umap_components = umap_components
        self.umap_neighbors = umap_neighbors

        # Load model
        logger.info(f"Loading Sentence-BERT model: {model_name}")
        device = 'cuda' if use_gpu else 'cpu'
        logger.info(f"Using device: {device}")

        try:
            self.model = SentenceTransformer(model_name, device=device)
            logger.info(f"Model loaded successfully: {model_name} (device: {device})")
        except Exception as e:
            logger.error(f"Failed to load model {model_name}: {e}")
            raise

        # Initialize UMAP and HDBSCAN
        logger.info(f"Initializing UMAP reducer with n_components={umap_components}, n_neighbors={umap_neighbors}")
        self.umap_reducer = umap.UMAP(
            n_components=umap_components,
            n_neighbors=umap_neighbors,
            min_dist=0.0,
            random_state=umap_random_state,
            verbose=False
        )

        logger.info(
            f"Initializing HDBSCAN clusterer with min_cluster_size={min_cluster_size}, min_samples={min_samples}, metric={metric}")
        self.clusterer = hdbscan.HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            metric=metric,
            cluster_selection_method=cluster_selection_method,
            prediction_data=True  # Allow predicting new data
        )

        # Store results
        self.embeddings = None
        self.reduced_embeddings = None
        self.labels = None
        self.cluster_info = None

        logger.info("HDBSCANBERTClusterer initialization completed")

    def preprocess_text(self, text: str) -> str:
        """
        Text preprocessing

        Args:
            text: Raw text

        Returns:
            Cleaned text
        """
        if not isinstance(text, str):
            logger.warning(f"Non-string input received: {type(text)}, returning empty string")
            return ""

        original_length = len(text)

        # Remove special characters and extra spaces
        text = text.strip()

        # Remove @ mentions
        text = re.sub(r'@\S+', '', text)

        # Remove URLs
        text = re.sub(r'https?://\S+|www\.\S+', '', text)

        # Remove emojis (optional)
        emoji_pattern = re.compile("["
                                   u"\U0001F600-\U0001F64F"  # Emoticons
                                   u"\U0001F300-\U0001F5FF"  # Symbols
                                   u"\U0001F680-\U0001F6FF"  # Transport
                                   u"\U0001F700-\U0001F77F"  # Alchemy
                                   "]+", flags=re.UNICODE)
        text = emoji_pattern.sub('', text)

        # Remove extra spaces
        text = re.sub(r'\s+', ' ', text).strip()

        cleaned_length = len(text)
        if original_length > 0 and cleaned_length == 0:
            logger.debug(f"Text completely removed after preprocessing: original='{text[:50]}...'")

        return text

    def batch_encode(self, texts: List[str], batch_size: int = 32) -> np.ndarray:
        """
        Batch encode texts

        Args:
            texts: List of texts
            batch_size: Batch size

        Returns:
            Embedding vectors array
        """
        logger.info(f"Starting batch encoding for {len(texts)} texts with batch_size={batch_size}")

        # Batch encode to avoid memory issues
        all_embeddings = []
        num_batches = (len(texts) + batch_size - 1) // batch_size

        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            batch_num = i // batch_size + 1
            logger.debug(f"Encoding batch {batch_num}/{num_batches} (size: {len(batch)})")

            embeddings = self.model.encode(
                batch,
                batch_size=batch_size,
                show_progress_bar=True,
                convert_to_numpy=True
            )
            all_embeddings.append(embeddings)

        embeddings = np.vstack(all_embeddings)
        logger.info(f"Batch encoding completed: embedding shape = {embeddings.shape}")

        return embeddings

    def fit(self, texts: List[str], preprocess: bool = True) -> np.ndarray:
        """
        Train clustering model

        Args:
            texts: List of texts
            preprocess: Whether to preprocess

        Returns:
            Cluster labels
        """
        logger.info(f"Starting model fitting with {len(texts)} input texts (preprocess={preprocess})")

        # 1. Preprocessing
        if preprocess:
            logger.info("Starting text preprocessing...")
            processed_texts = [self.preprocess_text(t) for t in texts]
            logger.info(f"Sample cleaned text: {processed_texts[0] if processed_texts else 'N/A'}")

            # Filter empty texts
            self.original_texts = texts
            self.processed_texts = processed_texts
            self.valid_indices = [i for i, t in enumerate(processed_texts) if t]
            self.valid_texts = [processed_texts[i] for i in self.valid_indices]
        else:
            logger.info("Skipping text preprocessing")
            self.original_texts = texts
            self.processed_texts = texts
            self.valid_indices = list(range(len(texts)))
            self.valid_texts = texts

        valid_count = len(self.valid_texts)
        if valid_count == 0:
            logger.error("No valid data after preprocessing")
            raise ValueError("No valid data after preprocessing")

        logger.info(f"Valid data count: {valid_count} / {len(texts)} ({valid_count / len(texts) * 100:.1f}%)")

        # 2. Generate BERT embeddings
        logger.info("Generating BERT embeddings...")
        self.embeddings = self.batch_encode(self.valid_texts)

        # 3. UMAP dimensionality reduction
        logger.info(f"Applying UMAP dimensionality reduction to {self.umap_components} dimensions...")
        self.reduced_embeddings = self.umap_reducer.fit_transform(self.embeddings)
        logger.info(f"UMAP reduction completed: shape {self.reduced_embeddings.shape}")

        # 4. HDBSCAN clustering
        logger.info("Performing HDBSCAN clustering...")
        self.labels = self.clusterer.fit_predict(self.reduced_embeddings)

        # 5. Statistics
        n_clusters = len(set(self.labels)) - (1 if -1 in self.labels else 0)
        n_noise = np.sum(self.labels == -1)
        n_clustered = len(self.labels) - n_noise

        logger.info("=" * 60)
        logger.info("CLUSTERING RESULTS")
        logger.info(f"  - Number of clusters found: {n_clusters}")
        logger.info(f"  - Noise points: {n_noise} ({n_noise / len(self.labels) * 100:.1f}%)")
        logger.info(f"  - Clustered points: {n_clustered} ({n_clustered / len(self.labels) * 100:.1f}%)")

        # Additional clustering metrics if enough clusters
        if n_clusters >= 2:
            try:
                # Filter out noise points for metrics calculation
                mask = self.labels != -1
                if np.sum(mask) > 0:
                    silhouette = silhouette_score(self.reduced_embeddings[mask], self.labels[mask])
                    calinski = calinski_harabasz_score(self.reduced_embeddings[mask], self.labels[mask])
                    logger.info(f"  - Silhouette score: {silhouette:.4f}")
                    logger.info(f"  - Calinski-Harabasz score: {calinski:.2f}")
            except Exception as e:
                logger.warning(f"Could not compute clustering metrics: {e}")

        logger.info("=" * 60)

        # 6. Extract cluster information
        logger.info("Extracting cluster information and keywords...")
        self._extract_cluster_info()

        logger.info("Model fitting completed successfully")
        return self.labels

    def _extract_cluster_info(self):
        """Extract key information for each cluster"""
        logger.info("Starting cluster information extraction")

        self.cluster_info = {}

        # Get all unique cluster labels (excluding -1)
        unique_labels = set(self.labels)
        logger.info(f"Found {len(unique_labels)} unique labels (including noise)")

        from scipy.spatial.distance import cdist

        for label in unique_labels:
            if label == -1:
                logger.debug(f"Skipping noise cluster (label=-1)")
                continue

            # Get indices for this cluster
            cluster_indices = np.where(self.labels == label)[0]
            cluster_texts = [self.valid_texts[i] for i in cluster_indices]
            cluster_embeddings = self.embeddings[cluster_indices]

            logger.debug(f"Processing cluster {label}: size={len(cluster_texts)}")

            # Calculate cluster center
            cluster_center = cluster_embeddings.mean(axis=0)

            # Extract keywords
            keywords = self._extract_keywords(cluster_texts)
            logger.debug(f"Cluster {label} keywords: {keywords[:5]}")

            # Calculate intra-cluster average distance (density)
            distances = cdist([cluster_center], cluster_embeddings)[0]
            avg_distance = distances.mean()
            density = 1.0 / (avg_distance + 1e-6)

            self.cluster_info[label] = {
                'size': len(cluster_texts),
                'texts': cluster_texts,
                'keywords': keywords,
                'center': cluster_center,
                'avg_distance': avg_distance,
                'density': density,
                'indices': cluster_indices
            }

        logger.info(f"Extracted information for {len(self.cluster_info)} clusters")

    def _extract_keywords(self, texts: List[str], top_k: int = 10) -> List[str]:
        """
        Adaptive keyword extraction (supports Chinese/English, auto-adapts to data size)

        Args:
            texts: List of texts
            top_k: Number of keywords to return

        Returns:
            List of keywords
        """
        import re
        import numpy as np
        from collections import Counter

        if not texts:
            logger.warning("Empty text list provided for keyword extraction")
            return []

        # Basic statistics
        n_texts = len(texts)
        total_length = sum(len(t) for t in texts)
        avg_length = total_length / n_texts if n_texts > 0 else 0

        logger.debug(f"Extracting keywords from {n_texts} texts (avg length: {avg_length:.1f})")

        # Detect language
        all_text = ' '.join(texts)
        has_chinese = any('\u4e00' <= char <= '\u9fff' for char in all_text)
        logger.debug(f"Language detection: {'Chinese' if has_chinese else 'English'}")

        # Choose method based on data size
        if n_texts < 20:
            logger.debug(f"Using SMALL dataset keyword extraction method (n={n_texts})")
            result = self._extract_keywords_small(texts, top_k, has_chinese)
        elif n_texts < 100:
            logger.debug(f"Using MEDIUM dataset keyword extraction method (n={n_texts})")
            result = self._extract_keywords_medium(texts, top_k, has_chinese)
        else:
            logger.debug(f"Using LARGE dataset keyword extraction method (n={n_texts})")
            result = self._extract_keywords_large(texts, top_k, has_chinese)

        logger.debug(f"Extracted {len(result)} keywords: {result[:5]}")
        return result

    def _extract_keywords_small(self, texts: List[str], top_k: int, has_chinese: bool) -> List[str]:
        """
        Keyword extraction for very small datasets (< 20)
        Strategy: Word frequency + length weighting
        """
        import re
        from collections import Counter

        logger.debug("Extracting keywords using SMALL dataset strategy")

        # Combine all texts
        all_text = ' '.join(texts)

        # Tokenization
        if has_chinese:
            try:
                import jieba
                words = list(jieba.cut(all_text))
                logger.debug("Chinese tokenization using jieba")
            except ImportError:
                words = re.findall(r'[\u4e00-\u9fff]+', all_text)
                logger.debug("Chinese tokenization using regex fallback")
        else:
            words = re.findall(r'[a-zA-Z]+', all_text.lower())
            logger.debug("English tokenization using regex")

        # Stopwords
        stopwords = self._get_stopwords_small(has_chinese)

        # Filter
        filtered_words = []
        for w in words:
            w = w.lower().strip()
            if w not in stopwords and len(w) > 1 and not w.isdigit():
                filtered_words.append(w)

        # Count word frequency
        word_freq = Counter(filtered_words)

        # Calculate scores (frequency + length weighting)
        scores = {}
        for word, freq in word_freq.items():
            # Length weight (2-4 character words are more important)
            length_weight = 1.0
            if has_chinese:
                if 2 <= len(word) <= 4:
                    length_weight = 1.3
            else:
                if 3 <= len(word) <= 7:
                    length_weight = 1.3

            scores[word] = freq * length_weight

        # Sort
        sorted_words = sorted(scores.items(), key=lambda x: x[1], reverse=True)

        result = [word for word, _ in sorted_words[:top_k]]
        logger.debug(f"SMALL strategy extracted {len(result)} keywords")
        return result

    def _extract_keywords_medium(self, texts: List[str], top_k: int, has_chinese: bool) -> List[str]:
        """
        Keyword extraction for small datasets (20-100)
        Strategy: Term frequency + document frequency + POS weighting
        """
        import re
        import numpy as np
        from collections import Counter

        logger.debug("Extracting keywords using MEDIUM dataset strategy")

        n_docs = len(texts)

        # Tokenization and statistics
        word_freq = Counter()  # Total term frequency
        doc_freq = Counter()  # Document frequency

        for text in texts:
            # Process each comment separately
            if has_chinese:
                try:
                    import jieba
                    words = list(jieba.cut(text))
                except ImportError:
                    words = re.findall(r'[\u4e00-\u9fff]+', text)
            else:
                words = re.findall(r'[a-zA-Z]+', text.lower())

            # Count document frequency (unique words)
            unique_words = set(words)
            for w in unique_words:
                if len(w) > 1 and not w.isdigit():
                    doc_freq[w] += 1

            # Count total term frequency
            for w in words:
                if len(w) > 1 and not w.isdigit():
                    word_freq[w] += 1

        # Stopwords
        stopwords = self._get_stopwords_medium(has_chinese)

        # Calculate TF-IDF scores
        scores = {}
        for word, tf in word_freq.items():
            if word in stopwords:
                continue

            # Term frequency
            tf_score = np.log1p(tf)  # Log smoothing

            # Inverse document frequency
            df = doc_freq.get(word, 1)
            idf = np.log((n_docs + 1) / (df + 1)) + 1

            # Length weighting
            length_weight = 1.0
            if has_chinese:
                if 2 <= len(word) <= 4:
                    length_weight = 1.2
            else:
                if 4 <= len(word) <= 8:
                    length_weight = 1.2

            # POS weighting (if available)
            pos_weight = self._get_pos_weight(word, text, has_chinese) if has_chinese else 1.0

            scores[word] = tf_score * idf * length_weight * pos_weight

        # Sort
        sorted_words = sorted(scores.items(), key=lambda x: x[1], reverse=True)

        # English deduplication
        if not has_chinese:
            sorted_words = self._deduplicate_english(sorted_words)

        result = [word for word, _ in sorted_words[:top_k]]
        logger.debug(f"MEDIUM strategy extracted {len(result)} keywords")
        return result

    def _extract_keywords_large(self, texts: List[str], top_k: int, has_chinese: bool) -> List[str]:
        """
        Keyword extraction for large datasets (>= 100)
        Strategy: TF-IDF + n-gram + intelligent filtering
        """
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
            import numpy as np

            logger.debug("Extracting keywords using LARGE dataset strategy (TF-IDF)")

            # Preprocess texts
            processed_texts = []

            if has_chinese:
                try:
                    import jieba
                    # Chinese word segmentation
                    for text in texts:
                        words = list(jieba.cut(text))
                        processed_texts.append(' '.join(words))
                    logger.debug("Chinese tokenization with jieba for TF-IDF")
                except ImportError:
                    processed_texts = texts
                    logger.warning("jieba not available, using raw texts for Chinese TF-IDF")
            else:
                processed_texts = texts
                logger.debug("English texts ready for TF-IDF")

            # Configure TF-IDF
            if has_chinese:
                vectorizer = TfidfVectorizer(
                    max_features=200,
                    min_df=2,  # Appear in at least 2 documents
                    max_df=0.8,  # Appear in at most 80% of documents
                    ngram_range=(1, 2),  # Words and bigrams
                    token_pattern=r'(?u)\b\w+\b'
                )
            else:
                vectorizer = TfidfVectorizer(
                    max_features=200,
                    min_df=2,
                    max_df=0.8,
                    stop_words='english',
                    ngram_range=(1, 2)
                )

            # Calculate TF-IDF
            tfidf_matrix = vectorizer.fit_transform(processed_texts)
            logger.debug(f"TF-IDF matrix shape: {tfidf_matrix.shape}")

            # Calculate average TF-IDF score for each word
            avg_scores = np.array(tfidf_matrix.mean(axis=0)).flatten()

            # Get feature names
            feature_names = vectorizer.get_feature_names_out()

            # Sort
            top_indices = avg_scores.argsort()[-top_k:][::-1]

            # Extract keywords and filter
            keywords = []
            for idx in top_indices:
                word = feature_names[idx]
                # Filter single characters and pure numbers
                if len(word) > 1 and not word.isdigit():
                    # For Chinese, filter words that are too short or too long
                    if has_chinese:
                        if 2 <= len(word) <= 8:
                            keywords.append(word)
                    else:
                        keywords.append(word)

                if len(keywords) >= top_k:
                    break

            logger.debug(f"LARGE strategy extracted {len(keywords)} keywords via TF-IDF")
            return keywords[:top_k]

        except Exception as e:
            # Fallback to medium dataset method
            logger.warning(f"TF-IDF extraction failed: {e}, falling back to MEDIUM strategy")
            return self._extract_keywords_medium(texts, top_k, has_chinese)

    def _get_stopwords_small(self, has_chinese: bool) -> set:
        """Stopwords for very small datasets"""
        stopwords = {
            '的', '了', '是', '在', '我', '你', '他', '她', '它', '这', '那',
            'a', 'an', 'the', 'and', 'or', 'but', 'to', 'for', 'of', 'with',
            'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had'
        }

        if not has_chinese:
            stopwords.update(['good', 'bad', 'nice', 'great', 'really', 'very'])

        logger.debug(f"Loaded {len(stopwords)} stopwords for SMALL strategy")
        return stopwords

    def _get_stopwords_medium(self, has_chinese: bool) -> set:
        """Stopwords for medium datasets"""
        stopwords = {
            '的', '了', '是', '在', '我', '你', '他', '她', '它', '这', '那',
            '有', '和', '与', '就', '都', '而', '及', '把', '被', '让', '给',
            '也', '还', '要', '会', '能', '可以', '已经', '正在', '将', '着',
            'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for',
            'in', 'is', 'it', 'of', 'on', 'or', 'the', 'to', 'with', 'from',
            'this', 'that', 'these', 'those', 'have', 'has', 'had', 'was',
            'were', 'will', 'would', 'could', 'should', 'may', 'might'
        }

        if not has_chinese:
            stopwords.update([
                'good', 'bad', 'nice', 'great', 'really', 'very', 'just', 'like',
                'can', 'get', 'got', 'go', 'went', 'come', 'came', 'see', 'look'
            ])

        logger.debug(f"Loaded {len(stopwords)} stopwords for MEDIUM strategy")
        return stopwords

    def _get_pos_weight(self, word: str, context: str, has_chinese: bool) -> float:
        """Get part-of-speech weight (simplified version)"""
        if not has_chinese:
            return 1.0

        try:
            import jieba.posseg as pseg

            # Check only the first character
            for w, flag in pseg.cut(word):
                # Nouns, verbs, adjectives have higher weight
                if flag.startswith('n'):
                    return 1.3
                elif flag.startswith('v'):
                    return 1.2
                elif flag.startswith('a'):
                    return 1.2
                elif flag.startswith('nr') or flag.startswith('ns'):
                    return 1.4
                break

            return 1.0
        except Exception as e:
            logger.debug(f"POS tagging failed for word '{word}': {e}")
            return 1.0

    def _deduplicate_english(self, sorted_words):
        """English word stem deduplication"""
        try:
            from nltk.stem import PorterStemmer
            stemmer = PorterStemmer()

            unique_words = []
            seen_stems = set()

            for word, score in sorted_words:
                stem = stemmer.stem(word)
                if stem not in seen_stems:
                    seen_stems.add(stem)
                    unique_words.append((word, score))

            logger.debug(f"Deduplicated English words: {len(sorted_words)} -> {len(unique_words)}")
            return unique_words
        except ImportError:
            logger.debug("nltk stemmer not available, skipping deduplication")
            return sorted_words

    def predict(self, new_texts: List[str]) -> np.ndarray:
        """
        Predict cluster labels for new texts

        Args:
            new_texts: List of new texts

        Returns:
            Predicted labels
        """
        logger.info(f"Predicting labels for {len(new_texts)} new texts")

        # Preprocessing
        processed = [self.preprocess_text(t) for t in new_texts]
        valid_count = sum(1 for t in processed if t)
        logger.debug(f"Valid texts after preprocessing: {valid_count}/{len(new_texts)}")

        # Encoding
        embeddings = self.batch_encode(processed)

        # UMAP transformation
        reduced = self.umap_reducer.transform(embeddings)
        logger.debug(f"UMAP transformed shape: {reduced.shape}")

        # HDBSCAN approximate prediction
        labels, _ = hdbscan.approximate_predict(self.clusterer, reduced)

        unique_labels = set(labels)
        logger.info(f"Prediction completed: {len(unique_labels)} unique labels found")

        return labels

    def filter_relevant_comments(
            self,
            post_text: Optional[str] = None,
            min_cluster_size: int = 3,
            relevance_threshold: float = 0.5,
            include_noise: bool = False
    ) -> Tuple[Dict, Dict]:
        """
        Filter comments relevant to the topic

        Args:
            post_text: Post content (for identifying topic clusters)
            min_cluster_size: Minimum cluster size
            relevance_threshold: Relevance threshold
            include_noise: Whether to include noise points

        Returns:
            (Filtered comments dict, Cluster info)
        """
        logger.info("Starting comment filtering")
        logger.debug(
            f"Parameters: min_cluster_size={min_cluster_size}, relevance_threshold={relevance_threshold}, include_noise={include_noise}")

        if self.labels is None:
            logger.error("Model not fitted yet. Please call fit() first")
            raise ValueError("Please call fit() first")

        # 1. Determine topic clusters
        if post_text:
            logger.info("Using post content to identify relevant clusters")
            post_processed = self.preprocess_text(post_text)
            post_embedding = self.model.encode([post_processed])[0]

            # Calculate similarity with each cluster center
            cluster_similarities = {}
            for label, info in self.cluster_info.items():
                similarity = self._cosine_similarity(post_embedding, info['center'])
                cluster_similarities[label] = similarity
                logger.debug(f"Cluster {label} similarity: {similarity:.4f}")

            # Select clusters with similarity above threshold
            relevant_clusters = [
                label for label, sim in cluster_similarities.items()
                if sim >= relevance_threshold and self.cluster_info[label]['size'] >= min_cluster_size
            ]

            logger.info(f"Found {len(relevant_clusters)} clusters above threshold {relevance_threshold}")

            # If no clusters above threshold, select top 2 most similar
            if not relevant_clusters:
                logger.warning(f"No clusters above threshold {relevance_threshold}, selecting top 2 most similar")
                sorted_clusters = sorted(cluster_similarities.items(),
                                         key=lambda x: x[1], reverse=True)
                relevant_clusters = [label for label, _ in sorted_clusters[:2]]
                logger.info(f"Selected top {len(relevant_clusters)} clusters: {relevant_clusters}")
        else:
            logger.info("No post content provided, selecting largest clusters")
            sorted_clusters = sorted(self.cluster_info.items(),
                                     key=lambda x: x[1]['size'], reverse=True)
            relevant_clusters = [label for label, _ in sorted_clusters[:2]]
            logger.info(f"Selected top {len(relevant_clusters)} largest clusters: {relevant_clusters}")

        # 2. Filter comments
        filtered_comments = defaultdict(list)

        # Add comments from valid clusters
        for label in relevant_clusters:
            if label not in self.cluster_info:
                logger.warning(f"Cluster {label} not found in cluster_info, skipping")
                continue

            info = self.cluster_info[label]
            logger.debug(f"Adding {len(info['texts'])} comments from cluster {label}")

            for idx, text in zip(info['indices'], info['texts']):
                filtered_comments[str(label)].append(text)

        # Add noise points (if requested)
        if include_noise:
            noise_indices = np.where(self.labels == -1)[0]
            logger.info(f"Adding {len(noise_indices)} noise points to results")

            for idx in noise_indices:
                filtered_comments["-1"].append(self.valid_texts[idx])

        logger.info(f"Filtering completed: {len(filtered_comments)} comments selected")
        return filtered_comments, self.cluster_info

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Calculate cosine similarity"""
        similarity = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
        return similarity

    def get_cluster_summary(self) -> pd.DataFrame:
        """Get cluster summary DataFrame"""
        if self.cluster_info is None:
            logger.warning("No cluster information available. Please call fit() first")
            return pd.DataFrame()

        logger.info("Generating cluster summary")

        summary = []
        for label, info in self.cluster_info.items():
            summary.append({
                'cluster_id': label,
                'size': info['size'],
                'keywords': ', '.join(info['keywords'][:5]),
                'density': f"{info['density']:.3f}",
                'percentage': f"{info['size'] / len(self.valid_texts) * 100:.1f}%"
            })

        # Sort by size
        summary.sort(key=lambda x: x['size'], reverse=True)

        logger.info(f"Generated summary for {len(summary)} clusters")
        return pd.DataFrame(summary)

    def visualize(
            self,
            save_path: Optional[str] = None,
            show_outliers: bool = True,
            figsize: Tuple[int, int] = (14, 10)
    ):
        """
        Visualize clustering results

        Args:
            save_path: Save path (optional)
            show_outliers: Whether to show noise points
            figsize: Figure size
        """
        if not VISUALIZATION_AVAILABLE:
            logger.error("Visualization libraries not available. Please install matplotlib and seaborn")
            print("Please install matplotlib and seaborn for visualization")
            return

        if self.reduced_embeddings is None:
            logger.error("No embeddings available. Please call fit() first")
            print("Please call fit() first")
            return

        logger.info("Starting visualization")

        # Further reduce to 2D for visualization
        from sklearn.manifold import TSNE

        logger.info("Reducing to 2D using t-SNE for visualization...")
        tsne = TSNE(n_components=2, random_state=42, perplexity=30)
        vis_embeddings = tsne.fit_transform(self.reduced_embeddings)
        logger.debug(f"t-SNE completed: shape {vis_embeddings.shape}")

        # Create figure
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=figsize)

        # 1. Cluster distribution plot
        unique_labels = sorted(set(self.labels))
        colors = plt.cm.tab20(np.linspace(0, 1, len(unique_labels)))

        plotted_clusters = 0
        for label, color in zip(unique_labels, colors):
            if label == -1 and not show_outliers:
                continue

            mask = self.labels == label
            label_name = f"Cluster {label}" if label != -1 else "Noise"
            marker = 'x' if label == -1 else 'o'
            alpha = 0.3 if label == -1 else 0.7
            size = 20 if label == -1 else 50

            ax1.scatter(vis_embeddings[mask, 0], vis_embeddings[mask, 1],
                        c=[color], label=label_name, marker=marker,
                        alpha=alpha, s=size)
            plotted_clusters += 1

        logger.info(f"Plotted {plotted_clusters} clusters on visualization")

        ax1.set_title('Comment Clustering Visualization')
        ax1.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
        ax1.grid(True, alpha=0.3)

        # 2. Cluster size distribution
        if self.cluster_info:
            cluster_sizes = [info['size'] for info in self.cluster_info.values()]
            cluster_ids = list(self.cluster_info.keys())

            ax2.bar(range(len(cluster_sizes)), cluster_sizes)
            ax2.set_xticks(range(len(cluster_sizes)))
            ax2.set_xticklabels([f'Cluster {cid}' for cid in cluster_ids], rotation=45)
            ax2.set_title('Cluster Size Distribution')
            ax2.set_xlabel('Cluster ID')
            ax2.set_ylabel('Number of Comments')
            ax2.grid(True, alpha=0.3)

            logger.debug(f"Plotted size distribution for {len(cluster_sizes)} clusters")

        plt.tight_layout()

        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
            logger.info(f"Visualization saved to: {save_path}")

        plt.show()
        logger.info("Visualization completed")

    def save_model(self, path: str):
        """Save model state"""
        logger.info(f"Saving model to: {path}")

        import pickle

        state = {
            'embeddings': self.embeddings,
            'reduced_embeddings': self.reduced_embeddings,
            'labels': self.labels,
            'cluster_info': self.cluster_info,
            'valid_indices': self.valid_indices,
            'valid_texts': self.valid_texts,
            'original_texts': self.original_texts,
            'clusterer': self.clusterer,
            'umap_reducer': self.umap_reducer,
            'config': {
                'min_cluster_size': self.min_cluster_size,
                'min_samples': self.min_samples,
                'umap_components': self.umap_components,
                'umap_neighbors': self.umap_neighbors
            }
        }

        try:
            with open(path, 'wb') as f:
                pickle.dump(state, f)
            logger.info(f"Model successfully saved to: {path} (size: {len(pickle.dumps(state))} bytes)")
        except Exception as e:
            logger.error(f"Failed to save model: {e}")
            raise

    def load_model(self, path: str):
        """Load model state"""
        logger.info(f"Loading model from: {path}")

        import pickle

        try:
            with open(path, 'rb') as f:
                state = pickle.load(f)

            self.embeddings = state['embeddings']
            self.reduced_embeddings = state['reduced_embeddings']
            self.labels = state['labels']
            self.cluster_info = state['cluster_info']
            self.valid_indices = state['valid_indices']
            self.valid_texts = state['valid_texts']
            self.original_texts = state['original_texts']
            self.clusterer = state['clusterer']
            self.umap_reducer = state['umap_reducer']

            logger.info(f"Model successfully loaded from: {path}")
            logger.info(
                f"Loaded model stats: {len(self.cluster_info) if self.cluster_info else 0} clusters, {len(self.valid_texts)} valid texts")
        except Exception as e:
            logger.error(f"Failed to load model from {path}: {e}")
            raise

# 测试示例代码
if __name__ == "__main__":
    cluster = HDBSCANBERTClusterer(min_cluster_size = 4, min_samples = 2, umap_components = 8, umap_neighbors = 8)

    post_text = "I love this new phone! The camera is amazing and battery life is great."
    comments = [
        "The camera quality is excellent!",
        "Camera is amazing, best I've used",
        "Love the camera features",
        "Camera is the best feature",
        "Amazing camera, photos look professional",
        "Camera quality blows me away",
        "The camera takes stunning photos",
        "Best camera on any phone I've owned",
        "Camera performance is outstanding",
        "Love the portrait mode on the camera",
        "Night mode on the camera is incredible",
        "Camera focuses super fast",
        "The ultra-wide camera is fantastic",
        "Camera produces vibrant colors",
        "Video stabilization is amazing",
        "4K video looks so crisp",
        "Selfie camera is surprisingly good",
        "Camera zoom is impressive",
        "Low light photos are excellent",
        "Camera app is very intuitive",
        "Great camera for social media posts",
        "Camera handles backlight perfectly",
        "The AI camera features are smart",
        "Camera captures amazing details",
        "Best camera experience overall",

        # 中性/混合评价
        "Camera is good but not great",
        "Camera quality is decent for the price",
        "Camera works well in good lighting",
        "Camera is okay, expected better",
        "Camera features are nice but need improvements",
        "Camera app could be faster",
        "Camera sometimes overexposes",
        "Camera is reliable but not spectacular",
        "Good camera but software needs update",
        "Camera is acceptable for daily use",

        # 负面评价
        "Camera quality is disappointing",
        "Camera fails in low light",
        "Camera software is buggy",
        "Camera focuses slowly",
        "Camera lacks detail in photos",
        "Camera quality is below average",
        "Camera makes photos look washed out",
        "Camera zoom is terrible",
        "Camera crashes often",
        "Camera video is shaky",

        # 具体功能讨论
        "The camera's night mode is revolutionary",
        "Camera's portrait mode has great edge detection",
        "Love how the camera handles skin tones",
        "Camera's pro mode gives full control",
        "Camera's slow-motion video is awesome",

        # ========== 电池相关评论 (50条) ==========
        # 积极评价
        "Battery life is amazing!",
        "Battery lasts all day easily",
        "Love the battery performance",
        "Battery charging is super fast",
        "Battery optimization is great",
        "Battery life exceeds expectations",
        "Best battery I've ever had",
        "Battery holds up well under heavy use",
        "Fast charging is a lifesaver",
        "Wireless charging works perfectly",
        "Battery management is excellent",
        "Battery doesn't drain overnight",
        "Battery health seems great",
        "Power saving mode works well",
        "Battery charges to full in 30 mins",

        # 中性/混合评价
        "Battery life is okay for moderate use",
        "Battery could be better but acceptable",
        "Battery performance is average",
        "Battery lasts through workday",
        "Battery is decent for the price",
        "Battery charging speed is okay",
        "Battery life meets expectations",
        "Battery is not bad but not great",
        "Battery holds up for a day",
        "Battery management is decent",

        # 负面评价
        "Battery life is disappointing",
        "Battery drains too fast",
        "Battery doesn't last a full day",
        "Battery performance is poor",
        "Battery charging is slow",
        "Battery life is terrible",
        "Battery overheats while charging",
        "Battery drains even when idle",
        "Battery health degraded quickly",
        "Battery replacement is expensive",

        # 具体使用场景
        "Battery lasts 8 hours of screen time",
        "Battery handles gaming well",
        "Battery life while streaming is good",
        "Battery during video calls is impressive",
        "Battery standby time is excellent",
        "Battery with 5G drains faster",
        "Battery in cold weather dies quickly",
        "Battery charges wirelessly but slowly",
        "Battery sharing feature is useful",
        "Battery optimization improves after update",

        # ========== 其他主题评论 (30条) ==========
        # 价格相关
        "Good value for money",
        "Price is reasonable for features",
        "A bit expensive but worth it",
        "Too expensive for what you get",
        "Great phone at this price point",
        "Value for money is excellent",
        "Price could be lower",
        "Worth every penny",
        "Overpriced compared to competitors",
        "Good deal during sale",

        # 性能相关
        "Phone performance is smooth",
        "Fast processor, no lag",
        "Phone is very responsive",
        "Performance is top-notch",
        "Phone handles multitasking well",
        "Apps open instantly",
        "Phone gets warm during gaming",
        "Performance is consistent",

        # 屏幕相关
        "Screen is beautiful and bright",
        "Display quality is amazing",
        "Screen refresh rate is smooth",
        "Colors are vibrant",
        "Screen is easy on eyes",

        # 其他功能
        "Fingerprint sensor is fast",
        "Face unlock works well",
        "Water resistance is a plus",
        "Speakers sound great",
        "Build quality is premium",

        # ========== 无关/噪声评论 (20条) ==========
        "where shall we go later",
        "what's going on",
        "my best friend is Tom",
        "I like pizza for dinner",
        "weather is nice today",
        "what time is the meeting",
        "let's go shopping tomorrow",
        "I need to buy groceries",
        "how was your weekend",
        "the movie was great",
        "I love listening to music",
        "going to the gym later",
        "what's your favorite color",
        "I enjoy reading books",
        "travel plans for summer",
        "learning new language",
        "cooking dinner tonight",
        "watching Netflix series",
        "playing video games",
        "working from home today"
    ]

    labels = cluster.fit(comments, preprocess=True)

    # 查看结果
    print("\n" + "=" * 50)
    print("Clustering Results")
    print("=" * 50)

    # 获取每个评论的聚类标签
    for i, (comment, label) in enumerate(zip(comments, labels)):
        if label == -1:
            print(f"Comment {i + 1}: [Noise] {comment}")
        else:
            print(f"Comment {i + 1}: [Cluster {label}] {comment}")

    # 查看聚类摘要
    print("\n" + "=" * 50)
    print("Clustering Summary")
    print("=" * 50)
    summary = cluster.get_cluster_summary()
    print(summary)

    # 筛选与帖子相关的评论
    relevant_comments, cluster_info = cluster.filter_relevant_comments(
        post_text=post_text,
        min_cluster_size=2,
        relevance_threshold=0.3
    )


    print("\n" + "=" * 50)
    print("Relevant Comments")
    print("=" * 50)
    for comment in relevant_comments[:10]:  # 显示前10条
        print(f"[Cluster {comment['cluster_id']}] {comment['original_text']}")
