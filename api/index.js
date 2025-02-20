const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(
  cors({
    origin: "*",
    methods: "GET, POST",
  })
);

// fetch Met Museum department data
app.get("/api/departments", async (req, res) => {
  try {
    const response = await axios.get(
      "https://collectionapi.metmuseum.org/public/collection/v1/departments"
    );
    res.json(response.data);
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Error retrieving department data", error: err });
  }
});

// Fetch search query
app.get("/api/search", async (req, res) => {
  const searchQuery = req.query.q;
  const departmentId = req.query.departmentId;

  let searchURL = `https://collectionapi.metmuseum.org/public/collection/v1/search?`;

  if (departmentId) {
    searchURL += `&departmentId=${departmentId}`;
  }

  if (searchQuery) {
    searchURL += `&hasImages=true&q=${searchQuery}`;
  } else {
    searchURL += `&hasImages=true&q=*`;
  }

  try {
    console.log(`fetching from ${searchURL}`);
    const response = await axios.get(searchURL);
    res.json(response.data);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err });
  }
});

// Filters out unwanted artworks
const excludedIDs = [436730, 436180, 436798, 437891];

const isValidArt = (artwork) => {
  if (!artwork.primaryImage) return false;
  if (excludedIDs.includes(artwork.objectID)) return false;
  if (
    artwork.tags &&
    artwork.tags.some((tag) =>
      ["Female Nudes", "Male Nudes", "Nursing", "Madonna and Child"].includes(
        tag.term
      )
    )
  ) {
    return false;
  }
  return true;
};

// Get object details in batches
const MET_API_URL =
  "https://collectionapi.metmuseum.org/public/collection/v1/objects";
const MET_SEARCH_URL =
  "https://collectionapi.metmuseum.org/public/collection/v1/search?";

const fetchArtworkBatch = async (ids) => {
  const requests = ids.map((id) =>
    axios
      .get(`${MET_API_URL}/${id}`)
      .then((res) => res.data)
      .catch((err) => {
        if (err.response && err.response.status === 404) {
          return null;
        }
        console.error(`Error fetching object ${id}`, err);
        return null;
      })
  );

  const results = await Promise.allSettled(requests);
  return results
    .filter((r) => r.status === "fulfilled" && r.value && isValidArt(r.value))
    .map((r) => r.value)
    .sort((a, b) => a.objectID - b.objectID);
};

// Fetch paginated artworks
app.get("/api/artworks", async (req, res) => {
  try {
    const searchQuery = req.query.q;
    const departmentId = req.query.departmentId;
    const page = parseInt(req.query.page) || 1;
    const batchSize = 20;
    const limit = parseInt(req.query.limit) || 30;
    const validArtworks = [];

    let searchURL = `${MET_SEARCH_URL}`;
    if (departmentId) {
      searchURL += `&departmentId=${departmentId}`;
    }

    if (searchQuery) {
      searchURL += `&hasImages=true&q=${searchQuery}`;
    } else {
      searchURL += `&hasImages=true&q=*`;
    }

    console.log(`fetching from: ${searchURL}`);

    const { data } = await axios.get(searchURL);
    const allObjectIDs = data.objectIDs.sort((a, b) => a - b) || [];
    const totalObjects = allObjectIDs.length;

    if (totalObjects === 0) {
      return res.json({ page, total: 0, artwork: [] });
    }

    const startIndex = (page - 1) * limit;

    let i = startIndex;
    while (validArtworks.length < limit && i < allObjectIDs.length) {
      const batch = allObjectIDs.slice(i, i + batchSize);
      const fetchedBatch = await fetchArtworkBatch(batch);
      validArtworks.push(...fetchedBatch);
      i += batchSize;
    }

    res.json({
      page,
      total: totalObjects,
      artworks: validArtworks.slice(0, limit),
    });
  } catch (error) {
    console.error(error);
    res.json({ error: "Internal server error" });
  }
});

// Fallback for 404 error
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

module.exports = app;
