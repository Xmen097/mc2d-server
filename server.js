var io = require("socket.io"),
	pg = require('pg'), 
	request = require("request"),
	sha256 = require("sha256"),
	levenshtein = require('fast-levenshtein');

var socket, players;

function validateString(str) {
	return JSON.stringify(str).replace(/[^A-Za-z0-9]/g, '')
}


function init() {
	players = [];
	resetTimer=0;
	ip = process.env.IP || "0.0.0.0";
	var port = process.env.PORT-1 || 8079;
	port++;//workaround for server port bug

	if(process.env.DATABASE_URL) { // DB 
		pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) {
        if(err){
            throw new Error("Not able to connect: "+ err);
        } 
        pgClient.query('SELECT * FROM map', function(err,result) {
            if(err || result.rows.length<10){
            	if(err)
                	console.log(err);
		 		mapGenerator.generate();
		 		if(map) {
					console.log("Map was generated ")
					for(var a=0;a<map.length;a++) {
						var columnsStack="(y";
						for(var x=0;x<1000;x++) {
							columnsStack+=",_"+x;
						}
						columnsStack+=")";

						var queryStack="("+a;
						for(var b=0;b<map[a].length;b++) {
							queryStack+=","+map[a][b];
						}
						queryStack+=")";

						pgClient.query("INSERT INTO map "+columnsStack+" VALUES"+queryStack, function(err) {
							if(err) {
								console.log("FAILED writing map part to database: " + err)
								pgClient.query("INSERT INTO map "+columnsStack+" VALUES"+queryStack, function(err) {
									if(err) {
										throw new Error("FAILED writing map part to database: " + err)
									} else {
										console.log("Writen map part to database after error")
									}
								})
							} else {
								console.log("Writen map part to database")
							}
						})
					}	
				}
            } else {
            	console.log("Started map loading")
	          	pgClient.query("SELECT * FROM map", function(err, result) {
					if(err) {
						console.log("FAILED writing map part to database: " + err)
			          	pgClient.query("SELECT * FROM map", function(err, result) {
							if(err) {
								throw new Error("FAILED writing map part to database: " + err)
							} else if(result) {
								map = [[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[]];
								
								for(var a=0; a<result.rows.length; a++) {
									for (var b=0; b<1000;b++) {
										map[result.rows[a].y][b]=result.rows[a]["_"+b];
									}
								}
								console.log("Map was loaded successfully after error")
							}
						})
					} else if(result) {
						map = [[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[]];
						
						for(var a=0; a<result.rows.length; a++) {
							for (var b=0; b<1000;b++) {
								map[result.rows[a].y][b]=result.rows[a]["_"+b];
							}
						}
						console.log("Map was loaded successfully")
					}
				})
            }
		done();
       });
    });
	} else {
		mapGenerator.generate();
	}

	socket = io.listen(port, ip, function() {
    	console.log('Server is listening on port '+port);
	});
	socket.configure(function() {
    	socket.set("transports", ["websocket"]);
    	socket.set("log level", 2);
	});
    socket.sockets.on("connection", onSocketConnection);
	resetMessagesPerMinutes = setInterval(function() {
		for(var a=0;a<players.length;a++) {
			if(players[a].messagesPerMinute < 25)
				players[a].messagesPerMinute=0;
		}
	},60000);
	if(process.env.DATABASE_URL)
		pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) {
			furnaces = [];
			chests = [];
			pgClient.query("SELECT * FROM storage", function(err, result) {
				if(err) {
					console.log("Failed loading storages "+err);
					pgClient.query("SELECT * FROM storage", function(err, result) {
						if(err) {
							throw new Error("Failed loading storages "+err);
						} else {
							for(var a of result.rows) {
								var content = JSON.parse(a.content);
								if(content.length == 3) {
									furnaces.push({content: content, x:a.x, y:a.y, fuelProgress: 0, smeltProgress: 0, maxFuel: 0})
								} else {
									chests.push({content: content, x:a.x, y:a.y})
								}
							}
						}
					})
				} else {
					for(var a of result.rows) {
						var content = JSON.parse(a.content);
						if(content.length == 3) {
							furnaces.push({content: content, x:a.x, y:a.y, fuelProgress: 0, smeltProgress: 0, maxFuel: 0})
						} else {
							chests.push({content: content, x:a.x, y:a.y})
						}
					}
				}
			})
			done();
		})
	furnaceSmeltCheck = setInterval(furnaceSmelting, 1000);
}

function giveItemToBestInventoryPosition(item, count, id) {
	var index = players.indexOf(playerById(id))
	for(var a=0;a < players[index].inventory.hotbar.length; a++) {
		if(players[index].inventory.hotbar[a].item == item) {
			players[index].inventory.hotbar[a].count += count;
			return;
		}
	}
	for (var m=0;m < players[index].inventory.inventory.length; m++) {
		for(var a=0; a< players[index].inventory.inventory[m].length;a++) {
			if(players[index].inventory.inventory[m][a].item == item) {
				players[index].inventory.inventory[m][a].count += count;	
				return;	
			}
		}				
	}
	for(var a=0;a < players[index].inventory.hotbar.length; a++) {
		if(players[index].inventory.hotbar[a].item == undefined) {
			players[index].inventory.hotbar[a].count = count;
			players[index].inventory.hotbar[a].item = item;
			return;
		}
	}
	for (var m=0;m < players[index].inventory.inventory.length; m++) {
		for(var a=0; a < players[index].inventory.inventory[m].length;a++) {
			if(players[index].inventory.inventory[m][a].item == undefined) {
				players[index].inventory.inventory[m][a].count = count;
				players[index].inventory.inventory[m][a].item = item;	
				return;	
			}
		}				
	}
	console.log("Player "+playerById(id)+" inventory is full");
}

function invSpace(item, count) {
	this.item = item;
	this.count = count || 0;
}

function countItemsInRecipe(recipe) {
	var count = 0;
	for(var x of recipe) {
		if(x != undefined)
			count++;
	}
	return count-2;
}

function checkSmallCraftingResult(playerCrafting, playerID) {
	for(var a of smallRecipes) {
		var itemCount=0;
		var item;
		for(var m of playerCrafting) {
			if(m.item != undefined) {
				if(item == undefined)
					item=m;
				itemCount++;
			}
		}		
		if(a.length == 3 && itemCount==1 && item.item==a[0]) {
			for(var b=0;b<players[playerID].crafting.length;b++) {
				if(players[playerID].crafting[b].count > 0) {
					players[playerID].crafting[b].count--;
					if(players[playerID].crafting[b].count == 0)
						players[playerID].crafting[b].item = undefined;
				}
			}
			return new invSpace(a[1], a[2])
		} else if(a.length == 5 && itemCount==countItemsInRecipe(a) && item.item==a[0] && playerCrafting[playerCrafting.indexOf(item)+1] && playerCrafting[playerCrafting.indexOf(item)+1].item == a[1] && playerCrafting[playerCrafting.indexOf(item)+2] && playerCrafting[playerCrafting.indexOf(item)+2].item == a[2]) {
			for(var b=0;b<players[playerID].crafting.length;b++) {
				if(players[playerID].crafting[b].count > 0) {
					players[playerID].crafting[b].count--;
					if(players[playerID].crafting[b].count == 0)
						players[playerID].crafting[b].item = undefined;
				}
			}
			return new invSpace(a[3], a[4]);
		} else if(a.length == 6 && itemCount==countItemsInRecipe(a) && item.item==a[0] && playerCrafting[playerCrafting.indexOf(item)+1] && playerCrafting[playerCrafting.indexOf(item)+1].item == a[1] && playerCrafting[playerCrafting.indexOf(item)+2] && playerCrafting[playerCrafting.indexOf(item)+2].item == a[2] && playerCrafting[playerCrafting.indexOf(item)+3] && playerCrafting[playerCrafting.indexOf(item)+3].item == a[3]) {
			for(var b=0;b<players[playerID].crafting.length;b++) {
				if(players[playerID].crafting[b].count > 0) {
					players[playerID].crafting[b].count--;
					if(players[playerID].crafting[b].count == 0)
						players[playerID].crafting[b].item = undefined;
				}
			}
			return new invSpace(a[4], a[5]);
		} 
	}
	return new invSpace(undefined, 0);
}


function checkBigCraftingResult(playerCrafting, playerID) {
	for(var a of smallRecipes) {
		var itemCount=0;
		var item;
		for(var m of playerCrafting) {
			if(m != undefined && m.item != undefined) {
				if(item == undefined)
					item=m;
				itemCount++;
			}else if(m == undefined)
				break;
		}		
		if(a.length == 3 && itemCount==1 && item.item==a[0]) {
			for(var b=0;b<players[playerID].craftingTable.length;b++) {
				if(players[playerID].craftingTable[b].count > 0) {
					players[playerID].craftingTable[b].count--;
					if(players[playerID].craftingTable[b].count == 0)
						players[playerID].craftingTable[b].item = undefined;
				}
			}
			return new invSpace(a[1], a[2])
		} else if(a.length == 5 && itemCount==countItemsInRecipe(a) && item.item==a[0] && playerCrafting[playerCrafting.indexOf(item)+1] && playerCrafting[playerCrafting.indexOf(item)+1].item == a[1] && playerCrafting[playerCrafting.indexOf(item)+3] && playerCrafting[playerCrafting.indexOf(item)+3].item == a[2]) {
			for(var b=0;b<players[playerID].craftingTable.length;b++) {
				if(players[playerID].craftingTable[b].count > 0) {
					players[playerID].craftingTable[b].count--;
					if(players[playerID].craftingTable[b].count == 0)
						players[playerID].craftingTable[b].item = undefined;
				}
			}
			return new invSpace(a[3], a[4])
		} else if(a.length == 6 && itemCount==countItemsInRecipe(a) && item.item==a[0] && playerCrafting[playerCrafting.indexOf(item)+1] && playerCrafting[playerCrafting.indexOf(item)+1].item == a[1] && playerCrafting[playerCrafting.indexOf(item)+3] && playerCrafting[playerCrafting.indexOf(item)+3].item == a[2] && playerCrafting[playerCrafting.indexOf(item)+4] && playerCrafting[playerCrafting.indexOf(item)+4].item == a[3]) {
			for(var b=0;b<players[playerID].craftingTable.length;b++) {
				if(players[playerID].craftingTable[b].count > 0) {
					players[playerID].craftingTable[b].count--;
					if(players[playerID].craftingTable[b].count == 0)
						players[playerID].craftingTable[b].item = undefined;
				}
			}
			return new invSpace(a[4], a[5])
		}
	}
	for(var a of bigRecipes) {
		var itemCount=0;
		var item;
		for(var m of playerCrafting) {
			if(m != undefined && m.item != undefined) {
				if(item == undefined)
					item=m;
				itemCount++;
			}else if(m == undefined)
				break;
		}	
		if(itemCount==countItemsInRecipe(a) && item.item==a[0] && (a[1] ? playerCrafting[playerCrafting.indexOf(item)+1] && playerCrafting[playerCrafting.indexOf(item)+1].item == a[1] : true) && (a[2] ? playerCrafting[playerCrafting.indexOf(item)+2] && playerCrafting[playerCrafting.indexOf(item)+2].item == a[2] : true) && (a[3] ? playerCrafting[playerCrafting.indexOf(item)+3] && playerCrafting[playerCrafting.indexOf(item)+3].item == a[3] : true) && (a[4] ? playerCrafting[playerCrafting.indexOf(item)+4] && playerCrafting[playerCrafting.indexOf(item)+4].item == a[4] : true) && (a[5] ? playerCrafting[playerCrafting.indexOf(item)+5] && playerCrafting[playerCrafting.indexOf(item)+5].item == a[5] : true) && (a[6] ? playerCrafting[playerCrafting.indexOf(item)+6] && playerCrafting[playerCrafting.indexOf(item)+6].item == a[6] : true) && (a[7] ? playerCrafting[playerCrafting.indexOf(item)+7] && playerCrafting[playerCrafting.indexOf(item)+7].item == a[7] : true) && (a[8] ? playerCrafting[playerCrafting.indexOf(item)+8] && playerCrafting[playerCrafting.indexOf(item)+8].item == a[8] : true)) {
			for(var b=0;b<players[playerID].craftingTable.length;b++) {
				if(players[playerID].craftingTable[b].count > 0) {
					players[playerID].craftingTable[b].count--;
					if(players[playerID].craftingTable[b].count == 0)
						players[playerID].craftingTable[b].item = undefined;
				}
			}
			return new invSpace(a[9], a[10])
		}
	}
	return new invSpace(undefined, 0);
}

function drop(item1, count1, condition, item2, count2, activeItem) {
	count1 = count1 || 1;
	count2 = count2 || 1;
	if(activeItem != undefined && condition != undefined && items[activeItem].type == condition && item2 != undefined) {
		return {item: item2, count: count2};
	} else if(item1 != undefined){
		return {item: item1, count: count1};
	} else {
		return {item: undefined, count: 0};
	}
}

var inventoryPreset = {
	armor: [new invSpace(), new invSpace(), new invSpace(), new invSpace()],
	inventory: [[new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace()],
				[new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace()],
				[new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace()]
				],
	hotbar: [new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace()]			
}
var craftingPreset=[
		new invSpace(),
		new invSpace(), 
		new invSpace(), 
		new invSpace(),
		new invSpace()]; // crafting result field
var craftingTablePreset =[
		new invSpace(),new invSpace(),new invSpace(),
		new invSpace(),new invSpace(),new invSpace(),
		new invSpace(),new invSpace(),new invSpace(), new invSpace()]
var furnacePreset=[
		new invSpace(),
		new invSpace(), 
		new invSpace()
		]
var chestPreset = [new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(),
		 new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(),
		 new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace(), new invSpace()]


var furnaceRecipes=[[2, 54], [1, 0], [7, 55], [10, 56]]

var smeltingTime=1000;

var smeltingSpeed = 50;



var smallRecipes=[[2, 11, 4],
				 [11, 11, 11, 11, 12, 1],
				 [11,undefined ,11, 57, 4],
				 [55, undefined, undefined, 55, 34, 1]] 

var bigRecipes=[[1,1,1,
				 1,undefined,1,
				 1,1,1,
				 13, 1],
				[11,11,11,
				 11,undefined,11,
				 11,11,11,
				 58, 1],
				[11,undefined,undefined,
				 57,undefined,undefined,
				 57,undefined,undefined,
				 47, 1],
				[1,undefined,undefined,
				 57,undefined,undefined,
				 57,undefined,undefined,
				 48, 1],
				[55,undefined,undefined,
				 57,undefined,undefined,
				 57,undefined,undefined,
				 49, 1],
				[53,undefined,undefined,
				 57,undefined,undefined,
				 57,undefined,undefined,
				 50, 1],
				[56,undefined,undefined,
				 57,undefined,undefined,
				 57,undefined,undefined,
				 51, 1],				
				 [11,11,11,
				 undefined,57,undefined,
				 undefined,57,undefined,
				 35, 1],
				[1,1,1,
				 undefined,57,undefined,
				 undefined,57,undefined,
				 36, 1],
				[55,55,55,
				 undefined,57,undefined,
				 undefined,57,undefined,
				 37, 1],
				[53,53,53,
				 undefined,57,undefined,
				 undefined,57,undefined,
				 38, 1],
				[56,56,56,
				 undefined,57,undefined,
				 undefined,57,undefined,
				 39, 1],				
				 [11,11,undefined,
				 11,57,undefined,
				 undefined,57,undefined,
				 41, 1],
				[1,1,undefined,
				 1,57,undefined,
				 undefined,57,undefined,
				 42, 1],
				[55,55,undefined,
				 55,57,undefined,
				 undefined,57,undefined,
				 43, 1],
				[53,53,undefined,
				 53,57,undefined,
				 undefined,57,undefined,
				 44, 1],
				[56,56,undefined,
				 56,57,undefined,
				 undefined,57,undefined,
				 45, 1]]

var items = [
	{name: "stone", durability: 500, stack: 64, x:13, favType:"pickaxe", drop: [undefined, 0, "pickaxe", 1]},                            					    
	{name: "cobblestone", durability: 500, stack: 64, x:7, favType:"pickaxe", drop: [undefined, 0, "pickaxe", 1]},											
	{name: "wood", durability: 300, stack: 64, x:11, favType: "axe", smelting: 1000, drop: [2]},									
	{name: "leaves", durability: 50, stack: 64, x:12, favType:"scissors", smelting: 250, drop: [undefined, 0, "scissors", 3]},								
	{name: "grass", durability: 100, stack: 64, x:10, favType:"scissors", favType2: "shovel", drop: [5, 1, "scissors", 4]},							
	{name: "dirt", durability: 100, stack: 64, x:9, favType:"shovel", drop: [5]},											
	{name: "bedrock", durability: Infinity, drop: [undefined]},																		
	{name: "iron_ore", durability: 700, stack: 64, x:3, favType:"pickaxe", drop: [undefined, 0, "pickaxe", 7]},													
	{name: "coal_ore", durability: 600, stack: 64, x:0, favType:"pickaxe", drop: [undefined, 0, "pickaxe", 54]},		 										
	{name: "diamond_ore", durability: 1000, stack: 64, x:1, favType:"pickaxe", drop: [undefined, 0, "pickaxe", 53]},  										
	{name: "gold_ore", durability: 800, stack: 64, x:2, favType:"pickaxe", drop: [undefined, 0, "pickaxe", 10]},			 										
	{name: "wooden_planks", durability: 200, stack: 64, x:5, favType: "axe", smelting: 500, drop: [11]},								
	{name: "crafting_table", durability: 200, stack: 64, x:8, favType: "axe", active:"crafting", smelting: 1000, drop: [12]},			
	{name: "furnace", durability: 500, stack: 64, x:4, favType: "pickaxe", active:"furnace", drop: [undefined, 0, "pickaxe", 13]},								
	{name: "Leather_helmet", stack: 1, x:0, y:0, durability: 200, type: "helmet"},
	{name: "Chain_helmet", stack: 1, x:1, y:0, durability: 400, type: "helmet"},
	{name: "Iron_helmet", stack: 1, x:2, y:0, durability: 600, type: "helmet"},
	{name: "Diamond_helmet", stack: 1, x:3, y:0, durability: 800, type: "helmet"},
	{name: "Golden _helmet", stack: 1, x:4, y:0, durability: 1000, type: "helmet"},
	{name: "Leather_chestplate", stack: 1, x:0, y:1, durability: 200, type: "chestplate"},
	{name: "Chain_chestplate", stack: 1, x:1, y:1, durability: 400, type: "chestplate"},
	{name: "Iron_chestplate", stack: 1, x:2, y:1, durability: 600, type: "chestplate"},
	{name: "Diamond_chestplate", stack: 1, x:3, y:1, durability: 800, type: "chestplate"},
	{name: "Golden_chestplate", stack: 1, x:4, y:1, durability: 1000, type: "chestplate"},
	{name: "Leather_trousers", stack: 1, x:0, y:2, durability: 200, type: "trousers"},
	{name: "Chain_trousers", stack: 1, x:1, y:2, durability: 400, type: "trousers"},
	{name: "Iron_trousers", stack: 1, x:2, y:2, durability: 600, type: "trousers"},
	{name: "Diamond_trousers", stack: 1, x:3, y:2, durability: 800, type: "trousers"},
	{name: "Golden_trousers", stack: 1, x:4, y:2, durability: 1000, type: "trousers"},
	{name: "Leather_shoes", stack: 1, x:0, y:3, durability: 200, type: "shoes"},
	{name: "Chain_shoes", stack: 1, x:1, y:3, durability: 400, type: "shoes"},
	{name: "Iron_shoes", stack: 1, x:2, y:3, durability: 600, type: "shoes"},
	{name: "Diamond_shoes", stack: 1, x:3, y:3, durability: 800, type: "shoes"},
	{name: "Golden_shoes", stack: 1, x:4, y:3, durability: 1000, type: "shoes"},
	{name: "Scissors", stack:1, x:13, y:5, durability: 200, type: "scissors", multiplier:2},
	{name: "Wood_pickaxe", stack:1, x:0, y:6, durability: 500, type: "pickaxe", multiplier:6},
	{name: "Stone_pickaxe", stack:1, x:1, y:6, durability: 500, type: "pickaxe", multiplier:8},
	{name: "Iron_pickaxe", stack:1, x:2, y:6, durability: 500, type: "pickaxe", multiplier:10},
	{name: "Diamond_pickaxe", stack:1, x:3, y:6, durability: 500, type: "pickaxe", multiplier:12},
	{name: "Gold_pickaxe", stack:1, x:4, y:6, durability: 500, type: "pickaxe", multiplier:12},
	{name: "Admin_pickaxe", stack:1, x:5, y:6, durability: 500, type: "pickaxe", multiplier:Infinity},
	{name: "Wood_axe", stack:1, x:0, y:7, durability: 500, type: "axe", multiplier:3},
	{name: "Stone_axe", stack:1, x:1, y:7, durability: 500, type: "axe", multiplier:4},
	{name: "Iron_axe", stack:1, x:2, y:7, durability: 500, type: "axe", multiplier:5},
	{name: "Diamond_axe", stack:1, x:3, y:7, durability: 500, type: "axe", multiplier:6},
	{name: "Gold_axe", stack:1, x:4, y:7, durability: 500, type: "axe", multiplier:6},
	{name: "Admin_axe", stack:1, x:5, y:7, durability: 500, type: "axe", multiplier:Infinity},
	{name: "Wooden_shovel", stack:1, x:0, y:5, durability: 50, type: "shovel", multiplier:2},
	{name: "Stone_shovel", stack:1, x:1, y:5, durability: 200, type: "shovel", multiplier:3},
	{name: "Iron_shovel", stack:1, x:2, y:5, durability: 500, type: "shovel", multiplier:4},
	{name: "Diamond_shovel", stack:1, x:3, y:5, durability: 1000, type: "shovel", multiplier:5},
	{name: "Gold_shovel", stack:1, x:4, y:5, durability: 100, type: "shovel", multiplier:5},
	{name: "Admin_shovel", stack:1, x:5, y:5, durability: 100, type: "shovel", multiplier:Infinity},
	{name: "Diamond", stack: 64, x:7, y:3, type: "item"},
	{name: "Coal", stack: 64, x:7, y:0, type: "item", smelting: 4000},
	{name: "Iron_ingot", stack: 64, x:7, y:1, type: "item"},
	{name: "Gold_ingot", stack: 64, x:7, y:2, type: "item"},
	{name: "Stick", stack: 64, x:5, y:3, type: "item", smelting: 50},
	{name: "Chest", durability: 300, stack: 64, x:14, favType: "axe", active:"chest", drop: [58]},	
]

//map generator start

function randomRange(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function customChance(chance1, chance2, chance3) {
	var random = randomRange(1, chance1+chance2+chance3)
	if(random <= chance1) {
		return 0;
	} else if(random <= chance1+chance2) {
		return 1;
	}else
		return 2;
}
function mapGeneratorConstructor() {
	this.mapLength=1000;
	this.terainBaseHeight = 40;
	this.terainHeight=[];
	this.generate = function(){
		for(var a=0;a<100;a++) {
			this.terainHeight[a]=this.terainBaseHeight;
		}
		var actionsHistory=[];
		var adjustedTerain=0;
		while(adjustedTerain!=this.mapLength-1){
			var areaLength=randomRange(5,10);
			action = customChance(1,2,1);

			if(adjustedTerain+areaLength>this.mapLength-1){
				areaLength=this.mapLength-adjustedTerain-1;
			}
			if(action==0) {
				for(var m=1;m<areaLength+1;m++) {
					if(this.terainHeight[adjustedTerain+m-1]-2 > 20){
						this.terainHeight[adjustedTerain+m]=this.terainHeight[adjustedTerain+m-1]-customChance(4,5,1);
					}else {
						areaLength=m-1;
						break;
					}
				}
			}else if(action==1) {
				for(var m=1;m<areaLength+1;m++) {
					this.terainHeight[adjustedTerain+m]=this.terainHeight[adjustedTerain+m-1]+customChance(1,9,2)-1;
				}
			}else if(action==2) {
				for(var m=1;m<areaLength+1;m++) {
					if(this.terainHeight[adjustedTerain+m-1]+2 < 60){
						this.terainHeight[adjustedTerain+m]=this.terainHeight[adjustedTerain+m-1]+customChance(4,5,1);
					}else {
						areaLength=m-1;
						break;
					}
				}
			}
			adjustedTerain+=areaLength
		}
		map = [[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[],[]];
		for(var a=0; a<map.length;a++) {
			for(var b=0; b<this.mapLength;b++) {
				if (a>map.length-4) {
					map[a][b]=6;
				}else if(a>this.terainHeight[b]+3){
					if(randomRange(0, 100) || a<5 || b<5){
						map[a][b]=0;
					}else{
						var randomNum=randomRange(0,3)
						if(randomNum==0){
								map[a][b]=7
							if(randomRange(0,2))
								map[a][b-1]=7
							if(randomRange(0,2))
								map[a-1][b]=7
							if(randomRange(0,2))
								map[a-1][b-1]=7
							if(randomRange(0,2))
								map[a][b-2]=7
							if(randomRange(0,2))
								map[a-2][b]=7
						} else if(randomNum==1){
								map[a][b]=8
							if(randomRange(0,2))
								map[a][b-1]=8
							if(randomRange(0,2))
								map[a-1][b]=8
							if(randomRange(0,2))
								map[a-1][b-1]=8
							if(randomRange(0,2))
								map[a][b-2]=8
							if(randomRange(0,2))
								map[a-2][b]=8
						}if(randomNum==2){
								map[a][b]=9
							if(randomRange(0,2))
								map[a][b-1]=9
							if(randomRange(0,2))
								map[a-1][b]=9
							if(randomRange(0,2))
								map[a-1][b-1]=9
							if(randomRange(0,2))
								map[a][b-2]=9
							if(randomRange(0,2))
								map[a-2][b]=9
						}if(randomNum==3){
								map[a][b]=10
							if(randomRange(0,2))
								map[a][b-1]=10
							if(randomRange(0,2))
								map[a-1][b]=10
							if(randomRange(0,2))
								map[a-1][b-1]=10
							if(randomRange(0,2))
								map[a][b-2]=10
							if(randomRange(0,2))
								map[a-2][b]=10
						}
					}
				}else if(a>this.terainHeight[b]){
					map[a][b]=5;
				}else if(a>this.terainHeight[b]-1){
					map[a][b]=4;
				}else
					map[a][b]=-1;
			}
		}
		var treeCount=randomRange(this.mapLength/20,this.mapLength/10)
		for(var a=0;a<treeCount;a++) {
			var treeArea = Math.floor(this.mapLength/treeCount)
			var treePosition=randomRange(a*treeArea+3, (a+1)*treeArea-3)
			if(!randomRange(0,4)){
				map[this.terainHeight[treePosition]-1][treePosition]=2
				map[this.terainHeight[treePosition]-2][treePosition]=3
				map[this.terainHeight[treePosition]-2][treePosition+1]=3
				map[this.terainHeight[treePosition]-2][treePosition-1]=3
				map[this.terainHeight[treePosition]-3][treePosition]=3
				map[this.terainHeight[treePosition]-3][treePosition+1]=3
				map[this.terainHeight[treePosition]-3][treePosition-1]=3
			} else if(randomRange(0,2)){
				map[this.terainHeight[treePosition]-1][treePosition]=2
				map[this.terainHeight[treePosition]-2][treePosition]=2
				map[this.terainHeight[treePosition]-3][treePosition]=3
				map[this.terainHeight[treePosition]-3][treePosition+1]=3
				map[this.terainHeight[treePosition]-3][treePosition-1]=3
				map[this.terainHeight[treePosition]-4][treePosition]=3
				map[this.terainHeight[treePosition]-4][treePosition+1]=3
				map[this.terainHeight[treePosition]-4][treePosition-1]=3
			} else {
				map[this.terainHeight[treePosition]-1][treePosition]=2
				map[this.terainHeight[treePosition]-2][treePosition]=2
				map[this.terainHeight[treePosition]-3][treePosition]=2
				map[this.terainHeight[treePosition]-4][treePosition]=3
				map[this.terainHeight[treePosition]-4][treePosition+1]=3
				map[this.terainHeight[treePosition]-4][treePosition-1]=3
				map[this.terainHeight[treePosition]-5][treePosition]=3
				map[this.terainHeight[treePosition]-5][treePosition+1]=3
				map[this.terainHeight[treePosition]-5][treePosition-1]=3
			}
		}
	}
}
mapGenerator = new mapGeneratorConstructor();

//Map generator end

function Player(gtX, gtY, gtID, gtName, gtInv, gtRole, gtClient, gtCrafting, gtCraftingTable) {
	this.id = gtID,
	this.name = gtName,
	this.x = gtX,
	this.y = gtY;
	this.inventory = gtInv;
	this.messagesPerMinute=0;
	this.role = gtRole;
	this.client = gtClient;
	this.crafting = gtCrafting;
	this.craftingTable = gtCraftingTable;
	this.slot = 4;

}

function copyArr(arr){
	if(arr == undefined || arr.constructor == String || arr.constructor == Number|| arr.constructor == Boolean) {
		return arr;
	} else if(arr.constructor == Array) {
	    var newArr = arr.slice(0);
	    for(var i = 0; i<newArr.length; i++)
	            newArr[i] = copyArr(arr[i]);
	    return newArr;
	} else if(arr.constructor != Function) {
		var newArr = new arr.constructor();
		for(var a in arr) {
			newArr[a] = copyArr(arr[a]);
		}
		return newArr;
	} else {
		return arr;
	}
}

function playerById(id) {
    for (var i = 0; i < players.length; i++) {
        if (players[i].id == id)
            return players[i];
    };
}

function playerByName(name) {
    for (var i = 0; i < players.length; i++) {
        if (players[i].name == name)
            return players[i];
    };
}

function furnaceByPosition(x, y) {
    for (var i = 0; i < furnaces.length; i++) {
        if (furnaces[i].x == x && furnaces[i].y == y)
            return i;
    };
    return -1
}

function chestByPosition(x, y) {
    for (var i = 0; i < chests.length; i++) {
        if (chests[i].x == x && chests[i].y == y)
            return i;
    };
    return -1;
}

function onSocketConnection(client) {
    console.log("New player has connected: "+client.id);
	client.salt=sha256(Math.random()+"");
	client.emit("salt", client.salt)
    client.on("new player", onNewPlayer);
};

function onClientDisconnect() {
	var removePlayer = playerById(this.id);
	if (!removePlayer) {
	    console.log("Player not found: "+this.id);
	    return;
	};
    console.log("Player "+removePlayer.name+" has disconnected");

	this.broadcast.emit("new message", {name: "[SERVER]", message: "Player "+playerById(this.id).name+" has disconnected"})
	players.splice(players.indexOf(removePlayer), 1);
	this.broadcast.emit("remove player", {id: this.id});
};

function onNewPlayer(data) {
	var newInv = copyArr(inventoryPreset);
    var newCrafting = copyArr(craftingPreset);
    var newCraftingTable = copyArr(craftingTablePreset);
	var role=1;
	var client=this;
	console.log("Player "+validateString(data.name)+" send authorization token")
	request.post({url:'http://mc2d.herokuapp.com/index.php', form: {name: validateString(data.name), token: data.token, salt: this.salt}}, function(err,httpResponse,body){
		if(err) {
			throw new Error("Login server offline")
		}
		if(body == "true" && !playerByName(validateString(data.name))) {
			pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) {
       	 		if(err){
            		throw new Error("Not able to connect: "+ err);
            		return;
        		} 
        		pgClient.query("SELECT * FROM users WHERE name='"+validateString(data.name)+"'", function(err,result) {
        			if(result.rows[0]) {
        				role=result.rows[0].role|0;
        				newInv = JSON.parse(result.rows[0].inventory);
        				newCrafting = JSON.parse(result.rows[0].crafting);
        				newCraftingTable = JSON.parse(result.rows[0].craftingtable);
        				if(role == 0) {
							console.log("Player "+validateString(data.name)+" is banned");
							client.emit("disconnect", "You are banned")
							return;
						}
        				client.emit("inventory", result.rows[0]);
        			} else {
        				var role=1
        				pgClient.query("SELECT * FROM users", function(err,result) {
        					if(result.rowCount == 0)
        						role = 4;
		            		console.log("Player "+validateString(data.name)+" is new here!");
	        				client.emit("inventory", {name: validateString(data.name), role: 1, inventory: JSON.stringify(inventoryPreset), crafting: JSON.stringify(craftingPreset), craftingtable: JSON.stringify(craftingTablePreset)});
		            		pgClient.query("INSERT INTO users(name, role, inventory, crafting, craftingTable) VALUES ('"+validateString(data.name)+"',"+role+" ,'"+JSON.stringify(inventoryPreset)+"', '"+JSON.stringify(craftingPreset)+"', '"+JSON.stringify(craftingTablePreset)+"')", function(err) {
		            			if(err) {
		            				console.log("Failed creating player profile");
		            				return;
		            			}
		            		})
        				});
        			}
        			client.emit("new map", map)
				    client.on("disconnect", onClientDisconnect);
				    client.on("move player", onMovePlayer);
				    client.on("map edit", onMapEdit);
				    client.on("new message", onNewMessage);
				    client.on("block breaking", onBlockBreaking);
				    client.on("move item", onMoveItem);
				    client.on("storage block", onShowBlockContent);
					console.log("Player "+validateString(data.name)+" authorized successfully")
					client.broadcast.emit("new message", {name: "[SERVER]", message: "Player "+data.name+" connected to the server"})
					client.emit("new message", {name: "[SERVER]", message: "Welcome to the server"})
					var newPlayer = new Player(0, 0, client.id, validateString(data.name), newInv, role, client, newCrafting, newCraftingTable);
					client.broadcast.emit("new player", {id: parseInt(newPlayer.id), x: newPlayer.x, y: newPlayer.y, name: validateString(newPlayer.name), slot:newInv.hotbar[4]});
					var existingPlayer;
					for (var i = 0; i < players.length; i++) {
				    	existingPlayer = players[i];
				    	client.emit("new player", {id: parseInt(existingPlayer.id), x: existingPlayer.x, y: existingPlayer.y, name: validateString(existingPlayer.name), slot:existingPlayer.inventory.hotbar[existingPlayer.slot].item});
					};
					players.push(newPlayer);
        		})
			done();
        	})
		} else {
			console.log("Player "+validateString(data.name)+" authorization failed")
			client.emit("disconnect", "Your token is invalid(If the problem persist, try restarting the game)")
			client.disconnect(0)
		}
    })
};

function onNewMessage(data) {
	var sender = this;
	console.log("Player "+playerById(sender.id).name+" said: "+data);
	if(data[0] == "/") {
		var data = data.split("/")[1]
		var command = data.split(" ")[0]
		var argument = data.split(" ").splice(1).join(" ");
		switch(command) {
			case "ban":
				if(playerById(sender.id).role > 2) {
					if(process.env.DATABASE_URL)
						pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) {
							if(err) {
								sender.emit("new message", {name: "[SERVER]", message: "Something went wrong, please try again later"});
								return;
							}
							pgClient.query("SELECT role FROM users WHERE name='"+validateString(argument)+"'", function(err, result) { 
								if(result.rowCount) {
									if(result.rowCount && result.rows[0].role < playerById(sender.id).role) {
										pgClient.query("UPDATE users SET role=0 WHERE name='"+validateString(argument)+"'", function(err) {
											if(err) {
												sender.emit("new message", {name: "[SERVER]", message: "Error "+err})
											} else {
												if(playerByName(argument)){
													playerByName(argument).client.emit("disconnect", "You were banned from the server")
													playerByName(argument).client.broadcast.emit("remove player", {id: playerByName(argument).id});
													playerByName(argument).client.disconnect(0);
													sender.broadcast.emit("new message", {name: "[SERVER]", message: "Player "+argument+" was banned"})
													sender.emit("new message", {name: "[SERVER]", message: "Successfully banned "+argument})
												}
											}
										})
									} else {
										sender.emit("new message", {name: "[SERVER]", message: "You can't ban this player"})	
									}
								} else {
									sender.emit("new message", {name: "[SERVER]", message: "This player doesn't exist"})
									return;
								}
							});
						done();
						})
				} else {
					sender.emit("new message", {name: "[SERVER]", message: "You don't have permission to execute this command"})
				}
				break;
			case "name":
				if(playerById(sender.id).role > 3) {
					playerById(sender.id).name = argument;
					this.broadcast.emit("remove player", {id: sender.id});
					this.broadcast.emit("new player", {id: parseInt(sender.id), x: sender.x, y: sender.y, name: validateString(sender.name), slot:sender.inventory.hotbar[sender.slot].item});
				} else {
					sender.emit("new message", {name: "[SERVER]", message: "You don't have permission to execute this command"})
				}
				break;
			case "mute":
				if(playerById(sender.id).role > 2) {
					if(process.env.DATABASE_URL)
						pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) {
							if(err) {
								sender.emit("new message", {name: "[SERVER]", message: "Something went wrong, please try again later"});
								return;
							}
							pgClient.query("SELECT role FROM users WHERE name='"+validateString(argument)+"'", function(err, result) { 
								if(result.rowCount) {
									if(result.rowCount && result.rows[0].role < playerById(sender.id).role) {
										if(players.indexOf(playerByName(argument)) != -1) {
											players[players.indexOf(playerByName(argument))].messagesPerMinute++;
											playerByName(argument).client.emit("new message", {name: "[SERVER]", message: "You were muted by "+playerById(sender.id).name})
											sender.broadcast.emit("new message", {name: "[SERVER]", message: "Player "+playerByName(argument).name+" was muted by "+playerById(sender.id).name})
										} else {
											sender.emit("new message", {name: "[SERVER]", message: "Player is offline"})	
										}

									} else {
										sender.emit("new message", {name: "[SERVER]", message: "You can't mute this player"})	
									}
								} else {
									sender.emit("new message", {name: "[SERVER]", message: "This player doesn't exist"})
									return;
								}
							});
						done();
						})
				} else {
					this.emit("new message", {name: "[SERVER]", message: "You don't have permission to execute this command"})
				}
				break;
			case "unban":
				if(playerById(sender.id) && playerById(sender.id).role > 2) {
					if(process.env.DATABASE_URL)
						pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) {
							if(err) {
								sender.emit("new message", {name: "[SERVER]", message: "Error "+ err});
								return;
							}
							pgClient.query("SELECT role FROM users WHERE name='"+validateString(argument)+"'", function(err, result) { 
								if(result.rowCount && result.rows[0].role == 0){
									pgClient.query("UPDATE users SET role=1 WHERE name='"+validateString(argument)+"'", function(err) {
										if(err) {
											sender.emit("new message", {name: "[SERVER]", message: "Error "+err})
										} else {
											sender.emit("new message", {name: "[SERVER]", message: "Successfully unbanned "+argument})
										}
									})
								} else if(result.rowCount) {
									sender.emit("new message", {name: "[SERVER]", message: "This player is not banned"})
								}else {
									sender.emit("new message", {name: "[SERVER]", message: "This player doesn't exist"})
									return;
								}
							});
						done();
						})
				} else {
					sender.emit("new message", {name: "[SERVER]", message: "You don't have permission to execute this command"})
				}
				break;
			case "promote":
				if(playerById(sender.id).role > 2) {
					if(process.env.DATABASE_URL)
						pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) {
							if(err) {
								sender.emit("new message", {name: "[SERVER]", message: "Error "+err});
								return;
							}
							pgClient.query("SELECT role FROM users WHERE name='"+validateString(argument)+"'", function(err, result) { 
								if(result.rowCount && result.rows[0].role+1 < playerById(sender.id).role){
									pgClient.query("UPDATE users SET role="+parseInt(result.rows[0].role+1)+" WHERE name='"+validateString(argument)+"'", function(err) {
										if(err) {
											sender.emit("new message", {name: "[SERVER]", message: "Error"+err})
										} else {
											players[players.indexOf(playerByName(argument))].role++;
											sender.emit("new message", {name: "[SERVER]", message: "Successfully promoted "+argument})
											sender.broadcast.emit("new message", {name: "[SERVER]", message: "Player "+argument+" was promoted by "+playerById(sender.id).name})
										}
									})
								} else if(result.rowCount) {
									sender.emit("new message", {name: "[SERVER]", message: "You can't promote this player"})
									return;
								} else {
									sender.emit("new message", {name: "[SERVER]", message: "This player doesn't exist"})
									return;
								}
							});
						done();
						})
				} else {
					sender.emit("new message", {name: "[SERVER]", message: "You don't have permission to execute this command"})
				}
				break;
			case "demote":
				if(playerById(sender.id).role > 2) {
					if(process.env.DATABASE_URL)
						pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) {
							if(err) {
								sender.emit("new message", {name: "[SERVER]", message: "Error"+err});
								return;
							}
							pgClient.query("SELECT role FROM users WHERE name='"+validateString(argument)+"'", function(err, result) { 
								if(result.rowCount && result.rows[0].role < playerById(sender.id).role && result.rows[0].role>1 && playerById(sender.id).name != argument){
									pgClient.query("UPDATE users SET role="+parseInt(result.rows[0].role-1)+" WHERE name='"+validateString(argument)+"'", function(err) {
										if(err) {
											sender.emit("new message", {name: "[SERVER]", message: "Error"+err})
										} else {
											players[players.indexOf(playerByName(argument))].role++;
											sender.emit("new message", {name: "[SERVER]", message: "Successfully demoted "+argument})
											sender.broadcast.emit("new message", {name: "[SERVER]", message: "Player "+argument+" was demoted by "+playerById(sender.id).name})
										}
									})
								} else if(result.rowCount) {
									sender.emit("new message", {name: "[SERVER]", message: "You can't demote this player"})
									return;
								} else {
									sender.emit("new message", {name: "[SERVER]", message: "This player doesn't exist"})
									return;
								}
							});
						done();
						})
				} else {
					sender.emit("new message", {name: "[SERVER]", message: "You don't have permission to execute this command"})
				}
				break;
			case "kick":
				var findPlayer = playerById(sender.id);
				if(findPlayer && findPlayer.role > 2) {
					if(playerByName(argument) && playerByName(argument).role < playerById(sender.id).role) {
						playerByName(argument).client.emit("disconnect", "You were kicked from the server")
						playerByName(argument).client.broadcast.emit("remove player", {id: playerByName(argument).id});
						playerByName(argument).client.disconnect(0);
					} else {
						sender.emit("new message", {name: "[SERVER]", message: "You can't kick this player"})
					}
				} else {
					sender.emit("new message", {name: "[SERVER]", message: "You don't have permission to execute this command"})
				}
				break;
			case "reset":
				var findPlayer = playerById(sender.id);
				argument = argument.split(" ");
				time = (typeof argument[1]=="number" || typeof argument[1]=="string") ?  argument[1] : 10;
				if(findPlayer && findPlayer.role > 3) {
					if(argument[0] == "map") {
						sender.broadcast.emit("new message", {name: "[SERVER]", message: "Map will be deleted in "+time+" seconds!"})
						sender.emit("new message", {name: "[SERVER]", message: "Map will be deleted in "+time+" seconds!"})
						clearTimeout(resetTimer);
						resetTimer = setTimeout(function () {
							for(var a of players) {
								a.client.emit("disconnect", "Server was restarted")
								a.client.disconnect(0);
							}
							if(process.env.DATABASE_URL)
								pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) {
								pgClient.query("TRUNCATE map, storage")
								done();
								})
							init()
						}, time*1000);
					} else if (argument[0] == "players") {
						sender.broadcast.emit("new message", {name: "[SERVER]", message: "Inventories will be deleted in "+time+" seconds!"})
						sender.emit("new message", {name: "[SERVER]", message: "Inventories will be deleted in "+time+" seconds!"})
						clearTimeout(resetTimer);
						resetTimer = setTimeout(function () {
							for(var a of players) {
								a.client.emit("disconnect", "Server was restarted");
							}
							if(process.env.DATABASE_URL)
								pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) {
									pgClient.query("DELETE FROM users WHERE name!='"+validateString(findPlayer.name)+"'");
								done();
								})
							init()
						}, time=="now" ? 0 : time*1000);
					} else if(argument[0] == "all") {
						sender.broadcast.emit("new message", {name: "[SERVER]", message: "Server will be deleted in "+time+" seconds!"})
						sender.emit("new message", {name: "[SERVER]", message: "Server will be deleted in "+time+" seconds!"})
						clearTimeout(resetTimer);
						resetTimer = setTimeout(function () {
							for(var a of players) {
								a.client.emit("disconnect", "Server was restarted");
							}
							if(process.env.DATABASE_URL)
								pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) {
									pgClient.query("TRUNCATE map");
									pgClient.query("DELETE FROM users WHERE name!='"+validateString(findPlayer.name)+"'");
								done();
								})
							init()
						}, time=="now" ? 0 : time*1000);
					} else if(argument[0] == "server") {
						sender.broadcast.emit("new message", {name: "[SERVER]", message: "Server will restart in "+time+" seconds!"})
						sender.emit("new message", {name: "[SERVER]", message: "Server will restart in "+time+" seconds!"})
						clearTimeout(resetTimer);
						resetTimer = setTimeout(function () {
							for(var a of players) {
								a.client.emit("disconnect", "Server was restarted");
							}
							init()
						}, time=="now" ? 0 : time*1000);
					} else {
						sender.emit("new message", {name: "[SERVER]", message: 'Please use "/reset players", "/reset map", "/reset all" or "/reset server"'})
					}
				} else {
					sender.emit("new message", {name: "[SERVER]", message: "You don't have permission to execute this command"})
				}
				break;
			case "give":
				var findPlayer = playerById(sender.id);
				var args = argument.split(" ");
				var targetPlayer = playerByName(args[0]);
				var item=-1;
				var count=1;
				var smallestDistance=Infinity;
				var possibleItem=-1;
				if(findPlayer && findPlayer.role > 1) {
					if(targetPlayer) {
						if(args.length == 3 && parseInt(args[2]) == args[2]) {
							count = parseInt(args[2]);
						} else if(args.length != 2) {
							sender.emit("new message", {name: "[SERVER]", message: "Unsupported command format"})
							return;
						}
						if(items[parseInt(args[1])]) {
							item = parseInt(args[1]);
						} else {
							for(var a of items) {
								if(a.name.toLowerCase() == args[1].toLowerCase()) {
									item = items.indexOf(a);
									break;
								} else {
									var itemParts = a.name.split('_');
									if(itemParts.length>1)
										itemParts.push(a.name);
									for(var b of itemParts) {
										var distance = levenshtein.get(args[1].toLowerCase(), b.toLowerCase()) + (itemParts.length-1);
										if(distance < smallestDistance) {
											smallestDistance = distance;
											possibleItem = a.name;
										}
									}
								}
							}
							if(item==-1) {
								sender.emit("new message", {name: "[SERVER]", message: "Unknown item, did you mean: "+possibleItem})
								return;
							}
						}
						giveItemToBestInventoryPosition(item, count, targetPlayer.id);
						if(process.env.DATABASE_URL)
							pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) {
								pgClient.query("UPDATE users SET inventory='"+JSON.stringify(targetPlayer.inventory)+"' WHERE name='"+validateString(args[0])+"'", function(err) {
									if(err) {
										console.log("Failed saving player inventory "+err);
										console.log(validateString(playerById(id).name));
									} else {
										pgClient.query("SELECT * FROM users WHERE name='"+validateString(args[0])+"'", function(err,result) {
						        			if(result.rows[0]) {
						        				targetPlayer.client.emit("inventory", result.rows[0]);
												console.log("Player "+findPlayer.name+ " gived "+count+"x item "+item+" to player "+args[0]);
												if(targetPlayer != findPlayer)
													targetPlayer.client.emit("new message", {name: "[SERVER]", message: "Players "+findPlayer.name+ " gived you "+count+"x item "+items[item].name});
												findPlayer.client.emit("new message", {name: "[SERVER]", message: "Successfully gived "+count+"x item "+items[item].name+" to player "+args[0]});
											}
										})
									}
								})
								done();
							})

					} else {
						sender.emit("new message", {name: "[SERVER]", message: "Can't find target player"})
					}
				} else {
					sender.emit("new message", {name: "[SERVER]", message: "You don't have permission to execute this command"})
				}
				break;
			case "eval":
				var findPlayer = playerById(sender.id);
				if(findPlayer && findPlayer.role > 3) {
					eval(argument);
					sender.emit("new message", {name: "[SERVER]", message: "Successfully executed command"})
				} else {f
					sender.emit("new message", {name: "[SERVER]", message: "You don't have permission to execute this command"})
				}
				break;
			default:
				sender.emit("new message", {name: "[SERVER]", message: "Unknown command"})
				break;
		}
	} else {
		if(playerById(sender.id).messagesPerMinute < 18) {
			var role="";
			switch(playerById(sender.id).role) {
				case 2:
					role="[VIP] "
					players[players.indexOf(playerById(sender.id))].messagesPerMinute++;
					break;
				case 3:
					role="[MODERATOR] "
					break;
				case 4:
					role="[ADMIN] "
					break;
				default:
					players[players.indexOf(playerById(sender.id))].messagesPerMinute++;
					break;
			}
			sender.broadcast.emit("new message", {name: role+playerById(sender.id).name, message: data})
			sender.emit("new message", {name: "You", message: data})
		} else if(playerById(sender.id).messagesPerMinute < 20) {
			players[players.indexOf(playerById(sender.id))].messagesPerMinute++;
			sender.emit("new message", {name: "[SERVER]", message: "Please stop spamming or you will be muted!"})
		} else if(playerById(sender.id).messagesPerMinute == 20) {
			players[players.indexOf(playerById(sender.id))].messagesPerMinute++;
			sender.emit("new message", {name: "[SERVER]", message: "You were muted!"})
			sender.broadcast.emit("new message", {name: "[SERVER]", message: "Player "+playerById(sender.id).name+" was muted"})
		} else if(playerById(sender.id).messagesPerMinute > 20) {
			sender.emit("new message", {name: "[SERVER]", message: "You are muted, rejoin if you want to speak again"})
		}
	}		
}

function onMovePlayer(data) {
	var movePlayer = playerById(this.id);

	if (!movePlayer) {
	    console.log("Player not found: "+this.id);
	    return;
	};

	movePlayer.x = data.x;
	movePlayer.y = data.y;
	movePlayer.slot = parseInt(data.slot);
	this.broadcast.emit("move player", {id: parseInt(movePlayer.id), x: movePlayer.x, y: movePlayer.y, texture: parseInt(data.texture), slot: parseInt(movePlayer.inventory.hotbar[data.slot].item)});
}

function onMoveItem(data) {
	if(typeof data.count == "number" && typeof data.start.x == "number" && typeof data.start.y == "number" && typeof data.end.x == "number" && typeof data.end.y == "number") {
		var item;
		var playerID = players.indexOf(playerById(this.id));
		if(data.start.y < 3 && players[playerID].inventory.inventory[data.start.y][data.start.x].count-data.count >= 0) {
			players[playerID].inventory.inventory[data.start.y][data.start.x].count-=data.count;
			item = players[playerID].inventory.inventory[data.start.y][data.start.x].item;
			if(players[playerID].inventory.inventory[data.start.y][data.start.x].count < 1)
				players[playerID].inventory.inventory[data.start.y][data.start.x].item = undefined;
		} else if(data.start.y < 5 && players[playerID].inventory[data.start.y== 4 ? "armor" : "hotbar"][data.start.x].count-data.count >= 0) {
			item = players[playerID].inventory[data.start.y== 4 ? "armor" : "hotbar"][data.start.x].item;
			players[playerID].inventory[data.start.y== 4 ? "armor" : "hotbar"][data.start.x].count-=data.count;
			if(players[playerID].inventory[data.start.y== 4 ? "armor" : "hotbar"][data.start.x].count < 1)
				players[playerID].inventory[data.start.y== 4 ? "armor" : "hotbar"][data.start.x].item = undefined;
		} else if(data.start.y == 5 && data.start.x != 4 && players[playerID].crafting[data.start.x].count-data.count >= 0) {
			players[playerID].crafting[data.start.x].count-=data.count;
			item = players[playerID].crafting[data.start.x].item;
			if(players[playerID].crafting[data.start.x].count < 1)
				players[playerID].crafting[data.start.x].item = undefined;
		} else if(data.start.y == 5){
			var craftedItem = checkSmallCraftingResult(players[playerID].crafting, playerID);
			var craftingLimit=0;
			while(craftingLimit<1000 && craftedItem.count != data.count) {
				var newCraftedItem = checkSmallCraftingResult(players[playerID].crafting, playerID); 
				if(newCraftedItem.item == craftedItem.item) {
					craftedItem.count += newCraftedItem.count;
					craftingLimit++;
				} else
					break;
			}
			item = craftedItem.item;
		} else if(data.start.y == 6 && data.start.x != 9) {
			players[playerID].craftingTable[data.start.x].count-=data.count;
				item = players[playerID].craftingTable[data.start.x].item;
				if(players[playerID].craftingTable[data.start.x].count < 1)
					players[playerID].craftingTable[data.start.x].item = undefined;
		} else if(data.start.y == 6) {
			var craftedItem = checkBigCraftingResult(players[playerID].craftingTable, playerID);
			var craftingLimit=0;
			while(craftingLimit<1000 && craftedItem.count != data.count) {
				var newCraftedItem = checkBigCraftingResult(players[playerID].craftingTable, playerID); 
				if(newCraftedItem.item == craftedItem.item) {
					craftedItem.count += newCraftedItem.count;
					craftingLimit++;
				} else
					break;
			}
			item = craftedItem.item;
		} else if(data.start.x >= 100) {
			if(process.env.DATABASE_URL)
				pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) { 
					var chest = chestByPosition(data.start.x-100, data.start.y)
					if(chest != -1) {
						chests[chest].content[parseInt(data.start.z)].count-=data.count;
						item = chests[chest].content[parseInt(data.start.z)].item;
						if(chests[chest].content[parseInt(data.start.z)].count < 1) {
							chests[chest].content[parseInt(data.start.z)].item = undefined;
							chests[chest].content[parseInt(data.start.z)].count=0;
						}
						pgClient.query("UPDATE storage SET content='"+JSON.stringify(chests[chest].content)+"' WHERE y="+parseInt(data.start.y)+" AND x="+parseInt(data.start.x-100), function(err) {
							if(err) {
								console.log("Failed updating chest inventory");
							} else { 
								console.log("Successfully updated chest inventory on "+data.start.x-100+","+data.start.y);
							}
						})
					}
					done();
				})
		} else if(data.start.y >= 100) {
			if(process.env.DATABASE_URL)
				pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) { 
					var furnace = furnaceByPosition(data.start.x, data.start.y-100)
					if(furnace != -1) {
						furnaces[furnace].content[parseInt(data.start.z)].count-=data.count;
						item = furnaces[furnace].content[parseInt(data.start.z)].item;
						if(furnaces[furnace].content[parseInt(data.start.z)].count < 1){
							furnaces[furnace].content[parseInt(data.start.z)].item = undefined;
							furnaces[furnace].content[parseInt(data.start.z)].count=0;
						}
						pgClient.query("UPDATE storage SET content='"+JSON.stringify(furnaces[furnace].content)+"' WHERE y="+parseInt(data.start.y-100)+" AND x="+parseInt(data.start.x), function(err) {
							if(err) {
								console.log("Failed updating furnace inventory");
							} else {
								console.log("Successfully updated furnace inventory on "+data.start.x+","+data.start.y-100);
							}
						})
					}
					done();
				})
		}


		if(data.end.y < 3) {
			players[playerID].inventory.inventory[data.end.y][data.end.x].item=item;
			players[playerID].inventory.inventory[data.end.y][data.end.x].count+=data.count;
		} else if(data.end.y < 5){
			players[playerID].inventory[data.end.y== 4 ? "armor" : "hotbar"][data.end.x].item=item;
			players[playerID].inventory[data.end.y== 4 ? "armor" : "hotbar"][data.end.x].count+=data.count;
		} else if(data.end.y == 5){
			players[playerID].crafting[data.end.x].item=item;
			players[playerID].crafting[data.end.x].count+=data.count;
		} else if(data.end.y == 6) {
			players[playerID].craftingTable[data.end.x].item=item;
			players[playerID].craftingTable[data.end.x].count+=data.count;
		} else if(data.end.x >= 100) {
			if(process.env.DATABASE_URL)
				pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) {
					var chest = chestByPosition(data.end.x-100, data.end.y)
					if(chest != -1) {
						chests[chest].content[parseInt(data.end.z)].item = item;
						chests[chest].content[parseInt(data.end.z)].count += data.count;
						pgClient.query("UPDATE storage SET content='"+JSON.stringify(chests[chest].content)+"' WHERE y="+parseInt(data.end.y)+" AND x="+parseInt(data.end.x-100), function(err) {
							if(err) {
								console.log("Failed updating chest inventory");
							} else {
								console.log("Successfully updated chest inventory on "+data.end.x-100+","+data.end.y);
							}
						})
					}
					done();
				})
		} else if(data.end.y >= 100) {
			if(process.env.DATABASE_URL)
				pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) {
					var furnace = furnaceByPosition(data.end.x, data.end.y-100)
					if(furnace != -1) {
						furnaces[furnace].content[parseInt(data.end.z)].item = item;
						furnaces[furnace].content[parseInt(data.end.z)].count += data.count;
						pgClient.query("UPDATE storage SET content='"+JSON.stringify(furnaces[furnace].content)+"' WHERE y="+parseInt(data.end.y-100)+" AND x="+parseInt(data.end.x), function(err) {
							if(err) {
								console.log("Failed updating furnace inventory");
							} else {
								console.log("Successfully updated furnace inventory on "+data.end.x+","+data.end.y-100);
							}
						})
					}
					done();
				})
		}
		var id=this.id;
		if(process.env.DATABASE_URL) {
			pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) { 
				pgClient.query("UPDATE users SET inventory='"+JSON.stringify(players[playerID].inventory)+"', crafting='"+JSON.stringify(players[playerID].crafting)+"', craftingTable='"+JSON.stringify(players[playerID].craftingTable)+"' WHERE name='"+validateString(players[playerID].name)+"'", function(err) {
					if(err) {
						console.log("Failed saving player inventory "+err);
						pgClient.query("UPDATE users SET inventory='"+JSON.stringify(players[playerID].inventory)+"', crafting='"+JSON.stringify(players[playerID].crafting)+"', craftingTable='"+JSON.stringify(players[playerID].craftingTable)+"' WHERE name='"+validateString(players[playerID].name)+"'", function(err) {
							if(err) {
								throw new Error("Failed saving player inventory "+err);
							} else {
								console.log("Player "+playerById(id).name+ " inventory was updated after error");
							}
						})
					} else {
						console.log("Player "+playerById(id).name+ " inventory was updated");
					}
				})
			done();
			})	
		}	
	}
}

function onMapEdit(data) {
	if(parseInt(data.block) == -1 && typeof map[parseInt(data.x)][parseInt(data.y)] != "undefined" && items[map[parseInt(data.x)][parseInt(data.y)]] && playerById(this.id).inventory.hotbar[parseInt(data.active)]) {
		var dropped = drop(items[map[parseInt(data.x)][parseInt(data.y)]].drop[0], items[map[parseInt(data.x)][parseInt(data.y)]].drop[1], items[map[parseInt(data.x)][parseInt(data.y)]].drop[2], items[map[parseInt(data.x)][parseInt(data.y)]].drop[3], items[map[parseInt(data.x)][parseInt(data.y)]].drop[4], playerById(this.id).inventory.hotbar[parseInt(data.active)].item)
		giveItemToBestInventoryPosition(dropped.item, dropped.count, this.id);
	} else if(playerById(this.id).inventory.hotbar[parseInt(data.active)] && playerById(this.id).inventory.hotbar[parseInt(data.active)].item == parseInt(data.block) && playerById(this.id).inventory.hotbar[parseInt(data.active)].count > 0) {
		players[players.indexOf(playerById(this.id))].inventory.hotbar[parseInt(data.active)].count--;
		if(playerById(this.id).inventory.hotbar[parseInt(data.active)].count == 0) {
			players[players.indexOf(playerById(this.id))].inventory.hotbar[parseInt(data.active)].item = undefined;	
		}
	} else {
		return;
	}
	var destroyBlock=0;
	if(map[parseInt(data.x)][parseInt(data.y)] == 13) {
		destroyBlock=1;
	} else if(map[parseInt(data.x)][parseInt(data.y)] == 58) {
		destroyBlock=2;
	}
	map[parseInt(data.x)][parseInt(data.y)] = parseInt(data.block);
	this.broadcast.emit("map edit", {x: parseInt(data.x), y: parseInt(data.y), block: parseInt(data.block)})
	this.emit("map edit", {x: parseInt(data.x), y: parseInt(data.y), block: data.block});
	var id=this.id;
	if(process.env.DATABASE_URL) {
		pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) { 
			pgClient.query("UPDATE map SET _"+parseInt(data.y)+"="+parseInt(data.block)+" WHERE y="+parseInt(data.x), function(err) {
				if(err) {
					console.log("Failed map edit "+err)
				} else {
					console.log("Player "+playerById(id).name+ " edited map")
				}
			})
			pgClient.query("UPDATE users SET inventory='"+JSON.stringify(playerById(id).inventory)+"' WHERE name='"+validateString(playerById(id).name)+"'", function(err) {
				if(err) {
					console.log("Failed saving player inventory "+err);
					console.log(validateString(playerById(id).name));
				} else {
					console.log("Player "+playerById(id).name+ " inventory was updated");
				}
			})
			if(parseInt(data.block) == 13) { // Is furnace
				pgClient.query("INSERT INTO storage(x, y, content) VALUES ("+parseInt(data.y)+", "+parseInt(data.x)+", '"+JSON.stringify(furnacePreset)+"')", function(err) {
					if(err) {
						console.log("Failed creating storage block "+err);
					} else {
						furnaces.push({content: furnacePreset, x: parseInt(data.y), y: parseInt(data.x), fuelProgress: 0, smeltProgress: 0, maxFuel: 0});
						console.log("Furnace block creation sucess");
					}
				})
			} else if(parseInt(data.block) == 58) { // Is chest
				pgClient.query("INSERT INTO storage(x, y, content) VALUES ("+parseInt(data.y)+", "+parseInt(data.x)+", '"+JSON.stringify(chestPreset)+"')", function(err) {
					if(err) {
						console.log("Failed creating storage block "+err);
					} else {
						chests.push({content: chestPreset, x: parseInt(data.y), y: parseInt(data.x)})
						console.log("Chest block creation sucess");
					}
				})
			} else if(destroyBlock) {
				pgClient.query("DELETE FROM storage WHERE y="+parseInt(data.x)+" AND x="+parseInt(data.y), function(err) {
					if(err) {
						console.log("Failed deleting storage block "+err);
					} else if(destroyBlock==1) {
						var furnace = furnaceByPosition(parseInt(data.y), parseInt(data.x));
						if(furnace != -1) {
							furnaces.splice(furnace, 1);
							console.log("Furnace block deleting sucess");
						} else 
							console.log("Furnace block deleting failed");
					} else if(destroyBlock==2) {
						var chest = chestByPosition(parseInt(data.y), parseInt(data.x));
						if(chest != -1)
						{
							chests.splice(chest, 1);
							console.log("Chest block deleting sucess");
						} else 
							console.log("Chest block deleting failed");
					}
				})
			}
		done();
		})	
	}
}

function onBlockBreaking(data) {
	this.broadcast.emit("block breaking", {x: parseInt(data.x), y: parseInt(data.y), progress: parseInt(data.progress), id: this.id})
}

function onShowBlockContent(data) {
	var player = playerById(this.id);
	if(data.x <= player.x+7.5 && data.x >= player.x-7.5 && data.y <= player.y+7.5 && data.y >= player.y-7.5) {
		player.client.emit("storage block", furnaceByPosition(data.x, data.y) != -1 ? furnaces[furnaceByPosition(data.x, data.y)] : chestByPosition(data.x, data.y) != -1 ? chests[chestByPosition(data.x, data.y)] : null);
	} else {
		console.log("Player "+player.name+" tried to access storage block, but not in range")
	}
}

function furnaceSmelting() {
	for(var a=0; a < furnaces.length; a++) { 	
		if(furnaces[a].fuelProgress != 0) {
			furnaces[a].fuelProgress-=smeltingSpeed;
		}
		for(var c of furnaceRecipes) {
			if(furnaces[a].content[0].item == c[0]){
				if(furnaces[a].content[0].item == c[0] && furnaces[a].content[1].item != undefined && items[furnaces[a].content[1].item].smelting != undefined && furnaces[a].fuelProgress <= 0) {
					furnaces[a].fuelProgress = items[furnaces[a].content[1].item].smelting;
					furnaces[a].maxFuel = items[furnaces[a].content[1].item].smelting;
					furnaces[a].content[1].count--;
					if(furnaces[a].content[1].count==0)
						furnaces[a].content[1].item = undefined;
					if(process.env.DATABASE_URL)
						pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) { 
							pgClient.query("UPDATE storage SET content='"+JSON.stringify(furnaces[a].content)+"' WHERE y="+parseInt(furnaces[a].y)+" AND x="+parseInt(furnaces[a].x), function(err) {
								if(err) {
									console.log("Failed saving storage fuel consumption");
								} else {
									console.log("Storage fuel consumption sucess");
								}
							})
							done();
						});
				}
				if(furnaces[a].fuelProgress != 0) {
					if(furnaces[a].content[2].item==undefined && furnaces[a].content[0].item == c[0] || furnaces[a].content[2].item==c[1] && furnaces[a].content[0].item == c[0])
						furnaces[a].smeltProgress+=smeltingSpeed;
					if(furnaces[a].smeltProgress>=smeltingTime && furnaces[a].content[0].item == c[0]) {
						furnaces[a].smeltProgress=0;
						furnaces[a].content[2].count++;	
						furnaces[a].content[0].count--;	
						if(furnaces[a].content[0].count == 0)
							furnaces[a].content[0].item=undefined;
						furnaces[a].content[2].item=c[1];
						if(process.env.DATABASE_URL)
							pg.connect(process.env.DATABASE_URL,function(err,pgClient,done) { 
								pgClient.query("UPDATE storage SET content='"+JSON.stringify(furnaces[a].content)+"' WHERE y="+parseInt(furnaces[a].y)+" AND x="+parseInt(furnaces[a].x), function(err) {
									if(err) {
										console.log("Failed saving storage smelting");
									} else {
										console.log("Storage smelting saving sucess");
									}
								})
								done();
							});
					}
				}
				if(furnaces[a].fuelProgress == 0 || furnaces[a].content[0].item != c[0])
					furnaces[a].smeltProgress=0;
				break;
			}	
		}
	}
}

init();

process.on('uncaughtException', function (error) {
	try {
		pg.end()	
	} catch(err) {
		console.log(err);
	}
   console.log(error.stack);
});