from flask import Flask, request, jsonify, render_template
import aiohttp
import asyncio
import difflib
import os
import json
import ssl
import certifi
import logging
from aiohttp import ClientTimeout

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger()

app = Flask(__name__, template_folder='templates')

CACHE_FILE = os.path.join(os.path.dirname(__file__), 'data', 'pokemon_cache.json')
PROCESSED_CACHE_FILE = os.path.join(os.path.dirname(__file__), 'data', 'processed_pokemon_cache.json')
REQUEST_TIMEOUT = 10  # seconds

async def create_aiohttp_session():
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    timeout = ClientTimeout(total=REQUEST_TIMEOUT)
    return aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=ssl_context), timeout=timeout)

async def fetch(session, url):
    try:
        async with session.get(url) as response:
            if response.status != 200:
                logger.error(f"Failed to fetch {url}: {response.status}")
                return None
            return await response.json()
    except asyncio.TimeoutError:
        logger.error(f"Request to {url} timed out.")
        return None
    except aiohttp.ClientError as e:
        logger.error(f"Client error occurred while fetching {url}: {e}")
        return None

async def get_all_pokemon(session):
    url = "https://pokeapi.co/api/v2/pokemon?limit=10000"
    return await fetch(session, url)

async def cache_pokemon_data():
    async with await create_aiohttp_session() as session:
        logger.info("Fetching Pokémon data from PokeAPI...")
        pokemon_data = await get_all_pokemon(session)
        if pokemon_data:
            with open(CACHE_FILE, 'w') as f:
                json.dump(pokemon_data, f)
            logger.info("Pokemon data cached successfully.")
            await process_and_cache_pokemon_data(session, pokemon_data)

async def load_cached_pokemon_data():
    if os.path.exists(CACHE_FILE):
        logger.info("Loading cached Pokémon data...")
        with open(CACHE_FILE, 'r') as f:
            return json.load(f)
    else:
        await cache_pokemon_data()
        return await load_cached_pokemon_data()

async def check_for_updates():
    async with await create_aiohttp_session() as session:
        logger.info("Checking for updates...")
        cached_data = await load_cached_pokemon_data()
        current_data = await get_all_pokemon(session)
        if current_data['count'] != cached_data['count']:
            logger.info("Updates found, updating cache...")
            await cache_pokemon_data()
            logger.info("Pokemon data updated.")
        else:
            logger.info("No updates found.")
            if not os.path.exists(PROCESSED_CACHE_FILE):
                logger.info("Processed cache not found, processing data...")
                await process_and_cache_pokemon_data(session, cached_data)

async def process_and_cache_pokemon_data(session, pokemon_data):
    processed_data = []
    logger.info("Processing Pokémon data...")
    for i, pokemon in enumerate(pokemon_data['results']):
        logger.info(f"Processing Pokémon {i+1}/{len(pokemon_data['results'])}: {pokemon['name']}")
        pokemon_details = await fetch(session, pokemon['url'])
        if not pokemon_details:
            logger.error(f"Failed to fetch details for {pokemon['name']}")
            continue

        species_url = pokemon_details['species']['url']
        species_data = await fetch(session, species_url)
        varieties = species_data.get('varieties', []) if species_data else []

        for variety in varieties:
            variety_url = variety['pokemon']['url']
            variety_data = await fetch(session, variety_url)
            if not variety_data:
                logger.error(f"Failed to fetch variety details for {pokemon['name']}")
                continue

            types = variety_data['types']
            type_names = [type_info['type']['name'] for type_info in types]

            type_urls = [type_info['type']['url'] for type_info in types]
            type_data_list = await asyncio.gather(*[fetch(session, url) for url in type_urls])
            type_data_list = [data for data in type_data_list if data]
            effectiveness = calculate_type_effectiveness(type_data_list)

            processed_data.append({
                'name': variety_data['name'],
                'display_name': variety['pokemon']['name'].capitalize(),  # Corrected display_name assignment
                'form': variety['pokemon']['name'],
                'id': variety_data['id'],
                'types': type_names,
                'effectiveness': effectiveness
            })

    with open(PROCESSED_CACHE_FILE, 'w') as f:
        json.dump(processed_data, f)
    logger.info("Processed Pokémon data cached successfully.")

@app.route('/')
def index():
    return render_template('Pokemon Type Effectiveness.html')

@app.route('/api/pokemon', methods=['GET'])
async def get_pokemon_info():
    try:
        pokemon_name = request.args.get('name')
        if not pokemon_name:
            return jsonify({'error': 'No Pokémon name provided'}), 400

        # Ensure processed cache is loaded
        if not os.path.exists(PROCESSED_CACHE_FILE):
            logger.info("Processed cache not found, processing data...")
            await load_cached_pokemon_data()
            await check_for_updates()

        with open(PROCESSED_CACHE_FILE, 'r') as f:
            processed_data = json.load(f)

        matches = [pokemon for pokemon in processed_data if pokemon_name.lower() in pokemon['name'].lower()]

        if not matches:
            closest_matches = difflib.get_close_matches(pokemon_name.lower(), [p['name'] for p in processed_data])
            if closest_matches:
                suggestions = ', '.join([f'<a href="#" onclick="suggestPokemon(\'{match}\')">{match.capitalize()}</a>' for match in closest_matches])
                return jsonify({'error': f'Pokémon not found. Did you mean: {suggestions}'}), 404
            else:
                return jsonify({'error': 'Pokémon not found and no close matches available'}), 404

        # Debugging: Log matches to ensure correct data is being returned
        for match in matches:
            logger.info(f"Found match: {match}")

        return jsonify(matches)

    except Exception as e:
        logger.error(f"Error occurred: {e}", exc_info=True)
        return jsonify({'error': 'An error occurred while processing your request.'}), 500

def calculate_type_effectiveness(type_data_list):
    damage_multipliers = {}

    for type_data in type_data_list:
        damage_relations = type_data['damage_relations']

        for relation_type, related_types in damage_relations.items():
            multiplier = 1
            if relation_type == 'double_damage_from':
                multiplier = 2
            elif relation_type == 'half_damage_from':
                multiplier = 0.5
            elif relation_type == 'no_damage_from':
                multiplier = 0

            for related_type in related_types:
                type_name = related_type['name']
                if type_name not in damage_multipliers:
                    damage_multipliers[type_name] = 1
                damage_multipliers[type_name] *= multiplier

    effectiveness = {
        'four_times_effective': [],
        'super_effective': [],
        'normal_effective': [],
        'resistant': [],
        'immune': []
    }

    for type_name, multiplier in damage_multipliers.items():
        if multiplier == 4:
            effectiveness['four_times_effective'].append(type_name)
        elif multiplier == 2:
            effectiveness['super_effective'].append(type_name)
        elif multiplier == 1:
            effectiveness['normal_effective'].append(type_name)
        elif multiplier == 0.5:
            effectiveness['resistant'].append(type_name)
        elif multiplier == 0:
            effectiveness['immune'].append(type_name)

    all_types = set([
        'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 
        'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'
    ])
    categorized_types = (
        set(effectiveness['four_times_effective']) |
        set(effectiveness['super_effective']) |
        set(effectiveness['resistant']) |
        set(effectiveness['immune'])
    )
    effectiveness['normal_effective'] = list(all_types - categorized_types)

    return effectiveness



if __name__ == '__main__':
    try:
        logger.info("Starting initialization...")
        asyncio.run(check_for_updates())  # Ensure cache is updated on startup
        logger.info("Starting Flask server...")
        app.run(host='0.0.0.0', port=5000)
    except Exception as e:
        logger.error(f"Fatal error occurred: {e}", exc_info=True)
        input("Press Enter to exit...")  # Keep the console window open
