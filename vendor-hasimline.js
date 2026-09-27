/* ==========================================================================
   VENDOR SPOTLIGHT: HASIMLINE
   Edit the two lists below to update the blog post (blog-hasimline.html).

   PRODUCTS: copy each item from https://hasimline.qshop.ng/
     - name  : product name
     - price : price as shown on their store (e.g. "₦25,000")
     - image : image URL (right-click the product photo > "Copy image address")
               or a local file such as "img/hasimline/agbada.jpg"
     - link  : the product's page on hasimline.qshop.ng
     - video : (optional) product video address ending in .mp4. When set, the
               card plays the video instead of showing the image.

   VIDEOS: paste any of these link types and it will be embedded automatically
     - YouTube   : https://www.youtube.com/watch?v=XXXX  or  https://youtu.be/XXXX
     - TikTok    : https://www.tiktok.com/@user/video/1234567890
     - Instagram : https://www.instagram.com/reel/XXXX/  or  /p/XXXX/
     - MP4 file  : img/videos/hasimline1.mp4
   Leave "product" empty or set it to a product name above to show a Shop button.
   ========================================================================== */

const HASIMLINE_STORE_URL = 'https://hasimline.qshop.ng/';

const HASIMLINE_PRODUCTS = [
    // Collected from https://hasimline.qshop.ng on 28 Sep 2026. Prices in Nigerian naira.
    // Hasimline has no product photos, so every card plays the product video instead.
    { name: 'Offwhite Minimal Kaftan', price: '₦150,000', link: 'https://hasimline.qshop.ng/products/offwhite-minimal-kaftan', video: 'https://ucarecdn.com/38c2f247-f0ee-4885-aa1e-03e21d01097b/video.mp4' },
    { name: 'Black Baroque', price: '₦150,000', link: 'https://hasimline.qshop.ng/products/black-baroque', video: 'https://ucarecdn.com/4d6a4bcc-342c-4b81-807b-601fed20f903/video.mp4' },
    { name: 'Yellow Sunshine', price: '₦150,000', link: 'https://hasimline.qshop.ng/products/yellow-sunshine', video: 'https://ucarecdn.com/fa0dd317-f4c3-489e-adb8-20863433ba2b/video.mp4' },
    { name: 'Navy Blue Elegant Kaftan', price: '₦150,000', link: 'https://hasimline.qshop.ng/products/navy-blue-elegant-kaftan', video: 'https://ucarecdn.com/849acd68-f6f6-43a6-9984-25778f9f56a6/video.mp4' },
    { name: 'Burnt Orange Outfit with Two Breast Pockets', price: '₦150,000', link: 'https://hasimline.qshop.ng/products/burnt-orange-outfit-with-two-breast-pockets', video: 'https://ucarecdn.com/938c2b8e-0909-44fa-8104-90f9a208af79/video.mp4' },
    { name: 'Black Essence', price: '₦150,000', link: 'https://hasimline.qshop.ng/products/black-essence', video: 'https://ucarecdn.com/dc2bdca2-023e-464b-b15e-ce0f9c755d30/video.mp4' },
    { name: 'Casual Offwhite with Print', price: '₦150,000', link: 'https://hasimline.qshop.ng/products/casual-offwhite-with-print', video: 'https://ucarecdn.com/af92d2c8-5bfa-4ca4-8fca-787b57f92f0b/video.mp4' },
    { name: 'Nude Casual Kaftan with Swarovski Stones', price: '₦160,000', link: 'https://hasimline.qshop.ng/products/nude-casual-kaftan-with-swarovski-stones', video: 'https://ucarecdn.com/cb62e142-4c78-46af-99d9-561a1e9a00bb/video.mp4' },
    { name: 'Burnt Orange Outfit', price: '₦150,000', link: 'https://hasimline.qshop.ng/products/burnt-orange-outfit', video: 'https://ucarecdn.com/e65c5c10-bc3e-44ac-8206-42f02df229fb/video.mp4' },
    // The store's own address for this product is spelled "causal".
    { name: 'Mint Green Casual Fit', price: '₦149,999', link: 'https://hasimline.qshop.ng/products/mint-green-causal-fit', video: 'https://ucarecdn.com/855b20b7-7ab1-4549-9ef6-dcfb1a5899fd/video.mp4' },
    { name: 'Offwhite Casual Kaftan with Native Print', price: '₦149,999', link: 'https://hasimline.qshop.ng/products/offwhite-casual-kaftan-with-native-print', video: 'https://ucarecdn.com/236a11be-dfd1-4bf1-a883-a90048757a84/video.mp4' }
];

const HASIMLINE_VIDEOS = [
    // The product cards above already play every product video, so this section is left
    // empty (and hidden) to avoid loading each video twice. Add extra videos here, e.g.
    // { url: 'https://www.tiktok.com/@hasimline/video/7400000000000000000', title: 'Behind the stitches', product: 'Black Baroque' },
];
