// all required modules
const express = require('express');
let app = express();
const mongoose = require("mongoose");
const Crawler = require('crawler');
app.set("view engine", "pug");
const {FruitPage, PersonalPage} = require("./PageModel");
const url = require('url');
const elasticlunr = require('elasticlunr');
const {Matrix} = require("ml-matrix");

// global variables
const PERSONALMAX = 800;
const FRUITMAX = 1000;
const MAX = 1000;

// Fruit URLs
let fruitSeedUrl = "https://people.scs.carleton.ca/~davidmckenney/fruitgraph/N-0.html"
let fruitBaseUrl = "https://people.scs.carleton.ca/~davidmckenney/fruitgraph/"

// Personal URLs
let personalSeedUrl = "https://en.wikipedia.org/wiki/Spider-Man"
let personalBaseUrl = "https://en.wikipedia.org/"

// Count tracking number of URLs crawled for each domain
let fruitCount = 0;
let personalCount = 0;

// PageNum for personal URls
let personalPageNum = 1;

// index for fruits & personal
let index_fruits;
let index_personal;
let groupName = "Ricky Gulati, Sia He, Vikrant Kumar"
let allResults;

// all the routes
app.get("/", (req,res,next)=>{res.render("pages/index");});
app.get("/searchFruits", (req,res,next)=>{res.render("pages/searchFruits");});
app.get("/fruits", getSearchResult);
app.get("/searchPersonal", (req,res,next)=>{res.render("pages/searchPersonal");});
app.get("/personal", getSearchResult);
app.get("/data/:id", getData);

// connect to database
mongoose.connect('mongodb://localhost/a1', {useNewUrlParser: true});
let db = mongoose.connection;

db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', async function() {
	// drop database "a1" if existed
	await mongoose.connection.dropDatabase();

  function checkPersonalUrl (url) {
    if (!url || !url.startsWith('/wiki/') || url.startsWith('/wiki/File:')) {
      return false;
    }
    if (url.toLowerCase().includes('main_page')) {
      return false;
    }
    return true;
  }

  // set to keep track on visted links to prevent revisits
  let personalVisited = new Set();

  function runPersonalCrawler () {
    let personalCBCount = 0;
    // initialize personal crawler
    const personalCrawler = new Crawler({
      maxConnections: 1,
      callback: personalCrawlerCB
    });

    function personalCrawlerCB (error, res, done) {
      if (error) {
        console.log(error);
      }
      else {
        let currentUrl = res.options.uri;

        personalCBCount++;
        console.log("CURRENT CRAWLED URL[" + personalCBCount + "]: " + currentUrl);
  
        // retrieve and process elements
        let $ = res.$;
        let links = $('a[href*="/wiki/"]:not([href*=":"]):not([href*="#"]):not([href*="disambiguation"])').slice(0, 20);
        let title = $("title").text();
        let body = $("p:not([class])").text().replace(/\n/g, ' ');
        
        // Set to keep track of duplicate links on CURRENT URL
        let localLinksVisited = new Set();
  
        // traverse the list of LINKS on CURRENT URL
        $(links).each(async function (i, link) {
          linkUrlText = $(link).text();
          linkUrlHref = $(link).attr('href');
  
          // Some checks for link validity
          if (!linkUrlHref.startsWith('/wiki/')) {
            return;
          }
          let linkCompleteUrl = url.resolve(personalBaseUrl, linkUrlHref);
          if (currentUrl === linkCompleteUrl) {
            return;
          }
          if (checkPersonalUrl(linkUrlHref) === false) {
            return;
          }
          if (localLinksVisited.has(linkCompleteUrl)) {
            return;
          }
          localLinksVisited.add(linkCompleteUrl);
  
          // IF LINK HAS BEEN personalVisited BEFORE
          // Add the current crawled URL to the link
          if(personalVisited.has(linkCompleteUrl)) {
            const filter = {url: linkCompleteUrl};
            const update = {
              $push: { incomingUrls: currentUrl },
              $inc: { incomingCount: 1 }
            };
            let result = await PersonalPage.findOneAndUpdate(filter, update, {new: true});
            if (!result) {
              console.log("LINK PAGE personalVisited BUT NOT IN DB");
            }
          }
  
          // IF LINKED HAS NOT BEEN personalVisited YET
          // Create new doc for link and add current URL to incoming URLs
          else{
            if (personalCount < PERSONALMAX) {
              let newPersonalPage = new PersonalPage({
                url: linkCompleteUrl,
                incomingCount: 1,
                outgoingCount: 0,
                pageNum: personalPageNum,
              });
              personalPageNum++;
              newPersonalPage.incomingUrls.push(currentUrl);
              await newPersonalPage.save();
              personalVisited.add(linkCompleteUrl);
              personalCrawler.queue(linkCompleteUrl);
              personalCount++;
              console.log("QUEUING URL[" + personalCount + "]: " + linkCompleteUrl);
            }
          }
  
          // CREATING NEW DOC FOR SEED URL
          if ((currentUrl === personalSeedUrl) && !personalVisited.has(personalSeedUrl)) {
            console.log("CREATING SEED PAGE");
            let newPersonalPage = new PersonalPage({
              url: personalSeedUrl,
              incomingCount: 0,
              outgoingCount: 0,
              pageNum: 0,
              title: title,
              body: body
            });
            personalVisited.add(personalSeedUrl);
            await newPersonalPage.save();
          }
  
          // ADDING CURRENT ITERATED LINK TO CURRENT CRAWLED PAGE DB
          const filter = {url: currentUrl};
          let update;
          // If link is not in DB, only update title, body of current crawled URL
          if (!personalVisited.has(linkCompleteUrl)) {
            update = {$set: {title: title, body: body}};
          }
          // If link is in DB, add it to current URL's outgoing 
          else {
            update = {
              $push: { outgoingUrls: linkCompleteUrl },
              $inc: { outgoingCount: 1 },
              $set: {title: title, body: body},
            };
          }
          let result = await PersonalPage.findOneAndUpdate(filter, update, {new: true});
          if (!result) {
            console.log("CURRENT CRAWLED PAGE NOT FOUND IN DB: " + currentUrl);
          }
        });
  
      }
      done();
    }

    personalCrawler.on('drain', async function() {
      if (personalCount < PERSONALMAX) {
        return;
      }
      wait(10).then(async () => {
        console.log("-----------------------------creating index for wikipedia-----------------------------")
        // update index
        let personalPages = await PersonalPage.find({});
        index_personal = await createIndex();
        index_personal = await indexPages(personalPages, index_personal);
        // calculate pageranks which is stored in index order AND update documents
        let pageRanks = await calculate(personalPages, personalCount);
        await personalPages.forEach(page => {
          page.pageRank = pageRanks[page.pageNum];
          page.save();
        });
        console.log("-----------------------------Done crawling WIKI for " + personalCount + " pages-----------------------------");
        app.listen(3000);
        console.log("Server listening at http://localhost:3000");
      })
    });
    personalCount++;
    console.log("QUEUING URL[" + personalCount + "]: " + personalSeedUrl);
    personalCrawler.queue(personalSeedUrl);
  }
});
/* --------------------------------- OTHER FUNCTIONS / APIS ------------------------------------ */
function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

// update Matrix for pagerank after crawling is done
async function updateMatrix(pages, matrix){
  let indices = {};
  pages.forEach(p => {
    let i = p.pageNum;
    indices[p.url] = i;
  });
  
  // update matrix
  pages.forEach(p => {
    let i = indices[p.url];
    let n = p.outgoingCount;
    //console.log("\n n ==== ", n)

    // non-dangling case - 1/outgoingLinksCount
    if(n > 0){
      p.outgoingUrls.forEach(outgoingUrl => {
        let j = indices[outgoingUrl];
        matrix.set(i, j, 1/n)
      })
    }
  })

  //console.log(matrix);
}

// function to calculate pageranks
async function calculate(pages, totalNumLinks){
  
  // initialize matrix
  let matrix =  Matrix.zeros(totalNumLinks, totalNumLinks);

  // update matrix after crawling
  await updateMatrix(pages, matrix);

  console.log("Calculating pageranks...")
  let alpha = 0.1;
  
  //Calc 1st matrix
  const multipliedMatrix1 = matrix.mul((1-alpha));

  //Calc 2nd matrix
  let value = 1/totalNumLinks
  const matrix2 = new Matrix(totalNumLinks, totalNumLinks).fill(value);
  const multipliedMatrix2 = matrix2.mul(alpha);

  //Calc final matrix
  const finalMatrix = Matrix.add(multipliedMatrix1, multipliedMatrix2)

  let pageArray = [1]
  for(let i = 0; i < totalNumLinks-1; ++i){
    pageArray.push(0)
  }

  let pageMatrix = new Matrix([pageArray]);

  let prevMatrix = new Matrix(1, MAX);
  prevMatrix.fill(0);
  let norm = 0;

  do {
    prevMatrix = pageMatrix;
    pageMatrix = pageMatrix.mmul(finalMatrix);
    const diffMatrix = Matrix.sub(pageMatrix, prevMatrix);
    norm = diffMatrix.norm();
  } while (norm >= 0.0001);

  
  pageRanks = pageMatrix.to1DArray();
  return pageRanks
} 

//function to initialize an empty index
async function createIndex(){
  let index = elasticlunr(function () {
    this.addField('title');
    this.addField('body');
    this.setRef('_id');
    this.saveDocument(false);
  });  
  return index;
}

// function to index all pages
// should only be called after crawling
async function indexPages(pages, index){
  console.log("Indexing pages...")
  //create doc by required attributes and add to the index
  pages.forEach(async page => {
    let doc = {
      title: page.title,
      body: page.body,
      _id: page._id,
      // pageRank: pageRanks[page.pageNum]
    };

    index.addDoc(doc);
  });
  console.log(`Total documents saved in index: ${index.documentStore.length}`);
  return index;
}

// get limit number of results for FRUITS based on scores
async function getTopLimitResults(index, limit, isBoost, query){
  // set boost factors of index fields
  let fields = {
    title: {boost: 1},
    body: {boost: 1},
  }

  let indexScores = index.search(query, {fields}, {bool: "OR"});

  let results = [];
  for(let i in indexScores){
    let page = await FruitPage.findById(indexScores[i].ref);
    console.log(page)
    let result = {
      ref: indexScores[i].ref,
      // if boost by pagerank, final score = pageRank score * index search score
      score: isBoost? indexScores[i].score * page.pageRank : indexScores[i].score,
      indexSearchScore: indexScores[i].score,
      pageRank: page.pageRank,
    }
    results.push(result); 
  } 

  // sort and slice limited number of results
  if(isBoost) results.sort((a, b) => b.score - a.score);
  results = results.slice(0, limit);

  // add dummy result from db if results.size < limit
  if (results.length < limit) {
    for (let i = results.length; i < limit; i++) {
      // get a page from db that has diiferent id then those object in results
      // (final) score and indexSearchScore is 0 since they didn't match any query
      let page = await FruitPage.findOne({_id: {$nin: results.map(result => result.ref)}});
      let result = {
        ref: page._id,
        score: 0,
        indexSearchScore: 0,
        pageRank: page.pageRank
      }
      results.push(result); 
    }
  }

  console.log("Search Query:", query);
  console.log("Boost: ", isBoost);
  console.log(`TOP ${limit} RESULTS:`);
  console.log(results);

  // return results with required field
  // currently included: title, url, incominglinks, outgoinglinks, wordcounts, score (final score) & indexSearchScore & pagerank score, ref (_id)
  // score = pageRank score * index search score if boost; otherwise final score = index search score
  for(let i in results){
    let page = await FruitPage.findById(results[i].ref)
    if (page) {
      let bodyWords = page.body.toLowerCase().split(' ');
      let titleWords = page.title.toLowerCase().split(' ');
      let queryWords = query.toLowerCase().split(' ');
      let wordCount = {};

      queryWords.forEach(word => {
        wordCount[word] = 0;
      });

      bodyWords.forEach(word => {
        if ((queryWords).includes(word)) {
          wordCount[word]++;
        }
      });

      titleWords.forEach(word => {
        if ((queryWords).includes(word)) {
          wordCount[word]++;
        }
      });

      results[i].title = page.title;
      results[i].url = page.url;
      results[i].outgoingLinks = page.outgoingUrls;
      results[i].incomingLinks = page.incomingUrls;
      results[i].wordCount = wordCount;
    }
  }
  return results;
}


// get limit number of results for PERSONAL based on scores
async function getTopLimitResultsPersonal(index, limit, isBoost, query){
  // set boost factors of index fields
  let fields = {
    title: {boost: 1},
    body: {boost: 1},
  }

  let indexScores = index.search(query, {fields}, {bool: "OR"});

  let results = [];
  for(let i in indexScores){
    let page = await PersonalPage.findById(indexScores[i].ref);
    console.log(page)
    let result = {
      ref: indexScores[i].ref,
      // if boost by pagerank, final score = pageRank score * index search score
      score: isBoost? indexScores[i].score * page.pageRank : indexScores[i].score,
      indexSearchScore: indexScores[i].score,
      pageRank: page.pageRank,
    }
    results.push(result); 
  } 

  // sort and slice limited number of results
  if(isBoost) results.sort((a, b) => b.score - a.score);
  results = results.slice(0, limit);

  // add dummy result from db if results.size < limit
  if (results.length < limit) {
    for (let i = results.length; i < limit; i++) {
      // get a page from db that has diiferent id then those object in results
      // (final) score and indexSearchScore is 0 since they didn't match any query
      let page = await PersonalPage.findOne({_id: {$nin: results.map(result => result.ref)}});
      let result = {
        ref: page._id,
        score: 0,
        indexSearchScore: 0,
        pageRank: page.pageRank
      }
      results.push(result); 
    }
  }

  console.log("Search Query:", query);
  console.log("Boost: ", isBoost);
  console.log(`TOP ${limit} RESULTS:`);
  console.log(results);

  // return results with required field
  // currently included: title, url, incominglinks, outgoinglinks, wordcounts, score (final score) & indexSearchScore & pagerank score, ref (_id)
  // score = pageRank score * index search score if boost; otherwise final score = index search score
  for(let i in results){
    let page = await PersonalPage.findById(results[i].ref)
    if (page) {
      let bodyWords = page.body.replace(/[.,!?]/g, '').toLowerCase().split(' ');
      let titleWords = page.title.replace(/[.,!?]/g, '').toLowerCase().split(' ');
      let queryWords = query.replace(/[.,!?]/g, '').toLowerCase().split(' ');
      let wordCount = {};

      queryWords.forEach(word => {
        wordCount[word] = 0;
      });

      bodyWords.forEach(word => {
        if ((queryWords).includes(word)) {
          wordCount[word]++;
        }
      });

      titleWords.forEach(word => {
        if ((queryWords).includes(word)) {
          wordCount[word]++;
        }
      });

      results[i].title = page.title;
      results[i].url = page.url;
      results[i].outgoingLinks = page.outgoingUrls;
      results[i].incomingLinks = page.incomingUrls;
      results[i].wordCount = wordCount;
    }
  }
  return results;
}


// function to calculate and return search result
async function getSearchResult(req,res,next){
  console.log("-----------------------------Start Search-----------------------------")
  //process query
  let searchQuery = req.query.q || "";
  let boost = req.query.boost === 'on';
  const checkLimit = parseInt(req.query.limit);

  if (!isNaN(checkLimit) && checkLimit <= 0) {
    // Invalid query parameter
    if (req.path === '/fruits') {
      res.format({
        "application/json": () => {res.status(400).json({ errorMessage: 'Invalid query limit. It must be a number greater than 0.' })},
        "text/html": () => {res.status(400).render('pages/searchFruits', { errorMessage: 'Invalid query limit. It must be a number greater than 0.' });}
      });
    }
    else {
      res.format({
        "application/json": () => {res.status(400).json({ errorMessage: 'Invalid query limit. It must be a number greater than 0.' })},
        "text/html": () => {res.status(400).render('pages/searchPersonal', { errorMessage: 'Invalid query limit. It must be a number greater than 0.' });}
      });
    }
    return;
  }
  let limit = req.query.limit || 10; // validation is done in ui, by default 10

  let index;
  req.path === '/fruits'? index = index_fruits : index = index_personal;

  // get limited number of results
  let results;
  if(req.path === '/fruits'){
    results = await getTopLimitResults(index, limit, boost, searchQuery);
  }
  else{
    results = await getTopLimitResultsPersonal(index, limit, boost, searchQuery);
  }
  allResults = results;

  //creates the JSON data
  let jsonRes = JSON.stringify(results.map(result => ({
      name: groupName,
      url: result.url,
      score: result.score,
      title: result.title,
      pr: result.pageRank
  })));
  jsonRes = JSON.parse(jsonRes);

  console.log(jsonRes);

  if(req.path === '/fruits'){
    res.format({
      "application/json": () => {res.status(200).json(jsonRes)},
      "text/html": () => {res.status(200).render("pages/fruits", {results: results})}
    });
  } else{
    res.format({
      "application/json": () => {res.status(200).json(jsonRes)},
      "text/html": () => {res.status(200).render("pages/personal", {results: results})}
    });
  }

  console.log("-----------------------------Done Search-----------------------------")
}


// Handles get request for data page
async function getData(req,res,next){

   //gets the required data 
  const Id = req.params.id;
  let result;
  for(i in allResults){
    if(allResults[i].ref == Id){
      result = allResults[i];
    }
  }

  console.log(result);

  res.format({
    "application/json": () => {res.status(200).json(result)},
    "text/html": () => {res.status(200).render("pages/data", {result: result})}
  });
}
