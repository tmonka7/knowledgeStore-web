import { MongoClient } from 'mongodb';
import { MongoDBAtlasVectorSearch } from '@langchain/mongodb';
import { OpenAIEmbeddings } from '@langchain/openai';

export const hasVectorSearchConfig = () => Boolean(
  process.env.OPENAI_API_KEY &&
  (process.env.MONGODB_ATLAS_URI || process.env.MONGODB_URI)
);

export const performVectorSearch = async ({
  query,
  records = [],
  limit = 20,
}) => {
  if (!query || !records.length || !hasVectorSearchConfig()) {
    return [];
  }

  const mongoUri = process.env.MONGODB_ATLAS_URI || process.env.MONGODB_URI;
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection(process.env.VECTOR_COLLECTION || 'knowledge_store_vectors');

    const vectorStore = new MongoDBAtlasVectorSearch(new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    }), {
      collection,
      indexName: process.env.VECTOR_INDEX || 'default',
      textKey: 'text',
      embeddingKey: 'embedding',
    });

    const docs = records.map((record) => ({
      pageContent: [
        record.title,
        record.category,
        record.content,
        record.attempt,
      ].filter(Boolean).join('\n'),
      metadata: {
        id: record.id,
        ownerId: record.ownerId,
        categoryId: record.categoryId,
        category: record.category,
        createdAt: record.createdAt,
      },
    }));

    await vectorStore.addDocuments(docs);

    const results = await vectorStore.similaritySearch(query, Math.min(limit, records.length));
    return results
      .map((doc) => doc.metadata?.id)
      .filter(Boolean);
  } catch (error) {
    console.error('Vector search failed, falling back to keyword search:', error.message);
    return [];
  } finally {
    await client.close();
  }
};
