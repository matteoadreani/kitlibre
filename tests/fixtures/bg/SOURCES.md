# Background-remover test fixtures

Downscaled (max 1024 px) copies of public-domain / CC0 photos from Wikimedia Commons:

| File | Source | Licence |
|---|---|---|
| portrait-aldrin.jpg | https://commons.wikimedia.org/wiki/File:Buzz_Aldrin.jpg (NASA) | Public domain |
| dog-labrador.jpg | https://commons.wikimedia.org/wiki/File:Portrait_of_a_labrador_retriever.jpg | CC0 |
| cat-grass.jpg | https://commons.wikimedia.org/wiki/File:Domestic_shorthair_cat_portrait_in_grass.jpg | CC0 |
| product-shoe.jpg | https://commons.wikimedia.org/wiki/File:Avia_Shoes.jpg | CC0 |

`*.mask.png` are 256×256 reference mattes produced offline by the **fp32** ormbg model (onnxruntime CPU, PIL bilinear
resize to 1024×1024, input /255). The e2e test compares the browser's int8 result against them (IoU at alpha 128), so a
broken preprocessing, wrong normalisation or corrupted model shows up as a low IoU. They are regression references,
not ground truth: on the cat and the shoe the model itself misses parts of the subject.
