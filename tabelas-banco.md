TABLE USER
id
email
name
password
score
auctions_count
items [relacionado]
auctions [relacionado]

TABLE ITEM
id
owner_id
name
description
category
images [array de strings da url do bucket]

TABLE AUCTION
id
title
description
owner_id
items [relacionado table items]
minimum_bid
start_at
finish_at
extra_time
winner [relacionado com usuario]
price_paid
status ['running', 'scheduled', 'finished', 'canceled']

